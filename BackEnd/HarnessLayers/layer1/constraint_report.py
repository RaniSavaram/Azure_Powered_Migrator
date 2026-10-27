"""
Builds the Constraint Agent's report from a Harness Layer 1 run.

layer1_Harness() answers "PASS or FAIL, and which issues"; the Constraint
Agent also needs the numbers behind that answer (primary key coverage,
foreign key integrity, which columns need a Fabric type change), rules it
can drill into, remediation SQL for *this* schema, and a step-by-step log.
Everything here is computed from the extracted metadata and the Layer 1
issues - nothing is a fixed demo value.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from HarnessLayers.layer1.Layer import _normalize_extracted_metadata

SECTION_TITLES = {
    "connection_validation": "Connection validation",
    "scan_validation": "Scan completeness",
    "metadata_validation": "Metadata, primary & foreign keys",
    "fabric_compatibility": "Microsoft Fabric compatibility",
    "governance_validation": "Governance & destructive SQL",
}

# Source type -> Fabric Warehouse type used for the remediation script.
FABRIC_TYPE_MAP = {
    "xml": "VARCHAR(MAX)",
    "geography": "VARCHAR(MAX) -- WKT text",
    "geometry": "VARCHAR(MAX) -- WKT text",
    "hierarchyid": "VARCHAR(4000) -- materialized path",
    "sql_variant": "VARCHAR(8000)",
    "string": "VARCHAR(8000)",
    "double": "FLOAT",
    "text": "VARCHAR(MAX)",
    "ntext": "VARCHAR(MAX)",
    "image": "VARBINARY(MAX)",
    "money": "DECIMAL(19,4)",
    "smallmoney": "DECIMAL(10,4)",
    "datetimeoffset": "DATETIME2(6) -- store offset separately",
    "smalldatetime": "DATETIME2(0)",
    "nchar": "CHAR",
    "nvarchar": "VARCHAR",
    "boolean": "BIT",
    "variant": "VARCHAR(MAX) -- JSON text",
    "object": "VARCHAR(MAX) -- JSON text",
    "array": "VARCHAR(MAX) -- JSON text",
}

# Platforms where TIMESTAMP means rowversion rather than a date-time.
ROWVERSION_PLATFORMS = {"sqlserver", "synapse"}

MAX_LISTED_OBJECTS = 50


def _qualified(schema: str | None, name: str | None) -> str:
    return f"{schema}.{name}" if schema else (name or "")


def _fabric_type_for(source_type: str, platform_slug: str) -> str:
    base = (source_type or "").lower().split("(")[0].strip()
    if base == "timestamp":
        return "BINARY(8) -- rowversion" if platform_slug in ROWVERSION_PLATFORMS else "DATETIME2(6)"
    if base in ("cursor", "table"):
        return "n/a (procedure-only type)"
    return FABRIC_TYPE_MAP.get(base, "review manually")


def _quote(identifier: str) -> str:
    return "[" + (identifier or "").replace("]", "]]") + "]"


def _issues(layer_result: dict, *rules: str) -> list[dict]:
    return [
        issue
        for section in layer_result.get("sections", [])
        for issue in section.get("issues", [])
        if issue.get("rule") in rules
    ]


def _status(errors: int, warnings: int) -> str:
    if errors:
        return "fail"
    if warnings:
        return "warn"
    return "pass"


def build_constraint_report(
    raw_metadata: dict,
    layer_result: dict,
    source: dict,
    duration_ms: int,
) -> dict[str, Any]:
    platform_slug = (source.get("platform_slug") or "").lower()
    normalized = _normalize_extracted_metadata(raw_metadata or {})
    tables = normalized["tables"]

    # ---------------- Primary keys ----------------
    keys_known = any(t.get("keys_declared") for t in tables)
    known_tables = [t for t in tables if t.get("keys_declared")]
    with_pk = [t for t in known_tables if t.get("primary_key")]
    without_pk = [_qualified(t["schema"], t["name"]) for t in known_tables if not t.get("primary_key")]
    pk_invalid = _issues(layer_result, "PRIMARY_KEYS_VALID")
    pk_coverage = round(100.0 * len(with_pk) / len(known_tables), 1) if known_tables else None

    # ---------------- Foreign keys ----------------
    fk_total = sum(len(t["foreign_keys"]) for t in tables)
    fk_broken = _issues(layer_result, "FOREIGN_KEYS_VALID")
    fk_out_of_scope = _issues(layer_result, "FK_TARGET_OUT_OF_SCOPE")
    broken_keys = {(i["context"].get("table"), i["context"].get("fk")) for i in fk_broken}
    out_of_scope_keys = {(i["context"].get("table"), i["context"].get("fk")) for i in fk_out_of_scope}
    fk_valid = max(fk_total - len(broken_keys | out_of_scope_keys), 0)
    fk_checkable = fk_total - len(out_of_scope_keys - broken_keys)
    fk_integrity = round(100.0 * fk_valid / fk_checkable, 1) if fk_checkable else None

    # ---------------- Data types ----------------
    type_findings = []
    for issue in _issues(layer_result, "UNSUPPORTED_DATA_TYPE", "UNKNOWN_DATA_TYPE"):
        ctx = issue.get("context", {})
        type_findings.append({
            "table": ctx.get("table"),
            "column": ctx.get("column"),
            "source_type": ctx.get("data_type"),
            "fabric_type": _fabric_type_for(ctx.get("data_type") or "", platform_slug),
            "status": "unsupported" if issue["rule"] == "UNSUPPORTED_DATA_TYPE" else "unknown",
        })
    unsupported_count = sum(1 for f in type_findings if f["status"] == "unsupported")

    # ---------------- Governance ----------------
    naming = _issues(layer_result, "NAMING_CONVENTION")
    sensitive = [
        {"table": i["context"].get("table"), "column": i["context"].get("column")}
        for i in _issues(layer_result, "SENSITIVE_DATA_IDENTIFICATION")
    ]
    destructive = [
        {
            "table": _qualified(i["context"].get("schema"), i["context"].get("table")),
            "statement": (i["context"].get("statement") or "").strip(),
        }
        for i in _issues(layer_result, "DESTRUCTIVE_SQL_DETECTED")
    ]
    structure = _issues(
        layer_result, "TABLES_PRESENT", "COLUMNS_PRESENT", "NO_DUPLICATE_OBJECTS",
        "NO_MALFORMED_METADATA", "REQUIRED_FIELDS_EXIST", "METADATA_JSON_VALID", "RELATIONSHIPS_VALID",
    )
    structure_errors = [i for i in structure if i.get("severity") == "ERROR"]

    def objects(items, fmt):
        return [fmt(i) for i in items[:MAX_LISTED_OBJECTS]]

    rules = [
        {
            "id": "RULE-C01",
            "category": "keys",
            "desc": (
                f"Primary keys: {len(with_pk)} of {len(known_tables)} tables declare one"
                if keys_known else "Primary keys: the source catalog's declared keys could not be read"
            ),
            "status": "fail" if pk_invalid else ("warn" if (without_pk or not keys_known) else "pass"),
            "count": len(pk_invalid) + len(without_pk),
            "objects": objects(pk_invalid, lambda i: i["message"]) + objects(without_pk, lambda t: f"{t}: no primary key"),
        },
        {
            "id": "RULE-C02",
            "category": "keys",
            "desc": (
                f"Foreign keys: {fk_valid} of {fk_total} verified"
                + (f", {len(fk_out_of_scope)} point outside the scanned tables" if fk_out_of_scope else "")
                if fk_total else (
                    "Foreign keys: none declared in the scanned tables" if keys_known
                    else "Foreign keys: the source catalog's declared keys could not be read"
                )
            ),
            "status": "fail" if fk_broken else ("warn" if fk_out_of_scope else ("pass" if keys_known else "info")),
            "count": len(fk_broken) + len(fk_out_of_scope),
            "objects": objects(fk_broken + fk_out_of_scope, lambda i: i["message"]),
        },
        {
            "id": "RULE-C03",
            "category": "datatypes",
            "desc": (
                f"Fabric data types: {len(type_findings)} column(s) need a type change or review"
                if type_findings else "Fabric data types: every column maps to a supported type"
            ),
            "status": "warn" if type_findings else "pass",
            "count": len(type_findings),
            "objects": objects(
                type_findings,
                lambda f: f"{f['table']}.{f['column']}: {f['source_type']} -> {f['fabric_type']}",
            ),
        },
        {
            "id": "RULE-C04",
            "category": "destructive",
            "desc": (
                f"Destructive SQL: {len(destructive)} DELETE/TRUNCATE statement(s) found"
                if destructive else "Destructive SQL: no DELETE/TRUNCATE statements found"
            ),
            "status": "fail" if destructive else "pass",
            "count": len(destructive),
            "objects": objects(destructive, lambda d: f"{d['table']}: {d['statement']}"),
        },
        {
            "id": "RULE-C05",
            "category": "governance",
            "desc": (
                f"Naming conventions: {len(naming)} identifier(s) need renaming"
                if naming else "Naming conventions: all identifiers are valid"
            ),
            "status": "fail" if naming else "pass",
            "count": len(naming),
            "objects": objects(naming, lambda i: i["message"]),
        },
        {
            "id": "RULE-C06",
            "category": "governance",
            "desc": (
                f"Sensitive data: {len(sensitive)} column(s) look sensitive and are not classified"
                if sensitive else "Sensitive data: no unclassified sensitive-looking columns"
            ),
            "status": "warn" if sensitive else "pass",
            "count": len(sensitive),
            "objects": objects(sensitive, lambda s: f"{s['table']}.{s['column']}"),
        },
        {
            "id": "RULE-C07",
            "category": "structure",
            "desc": (
                f"Metadata structure: {len(structure)} finding(s)"
                if structure else "Metadata structure: tables, columns and names are well formed"
            ),
            "status": "fail" if structure_errors else ("warn" if structure else "pass"),
            "count": len(structure),
            "objects": objects(structure, lambda i: i["message"]),
        },
    ]

    # Layer 1 skips the Fabric and governance sections when metadata
    # validation fails; their rules then weren't evaluated, not passed.
    skipped_sections = {
        s.get("section") for s in layer_result.get("sections", [])
        if any(i.get("rule") == "SKIPPED" for i in s.get("issues", []))
    }
    rule_sections = {
        "RULE-C03": "fabric_compatibility",
        "RULE-C04": "governance_validation",
        "RULE-C05": "governance_validation",
        "RULE-C06": "governance_validation",
    }
    for rule in rules:
        if rule_sections.get(rule["id"]) in skipped_sections:
            label = rule["desc"].split(":")[0]
            rule.update({
                "status": "info",
                "skipped": True,
                "desc": f"{label}: not checked - skipped because metadata validation failed",
                "count": 0,
                "objects": [],
            })

    scored = [r for r in rules if r["status"] != "info"]
    weights = {"pass": 1.0, "warn": 0.5, "fail": 0.0}
    compliance_score = round(100.0 * sum(weights[r["status"]] for r in scored) / len(scored), 1) if scored else 0.0

    decision = layer_result.get("decision", "FAIL")
    summary = layer_result.get("summary", {})
    metrics = [
        {
            "label": "PK Coverage",
            "value": f"{pk_coverage}%" if pk_coverage is not None else "Unknown",
            "color": "#16a34a" if pk_coverage == 100 else "#f97316",
        },
        {
            "label": "FK Integrity",
            "value": f"{fk_integrity}%" if fk_integrity is not None else ("None declared" if keys_known else "Unknown"),
            "color": "#16a34a" if fk_integrity in (None, 100) else "#dc2626",
        },
        {
            "label": "Flagged Types",
            "value": f"{len(type_findings)} column(s)",
            "color": "#f97316" if type_findings else "#16a34a",
        },
        {
            "label": "Governance Gate",
            "value": decision,
            "color": "#16a34a" if decision == "PASS" else "#dc2626",
        },
    ]

    sections = []
    for section in layer_result.get("sections", []):
        issues = section.get("issues", [])
        sections.append({
            "section": section.get("section"),
            "title": SECTION_TITLES.get(section.get("section"), section.get("section")),
            "passed": section.get("passed"),
            "errors": sum(1 for i in issues if i.get("severity") == "ERROR"),
            "warnings": sum(1 for i in issues if i.get("severity") == "WARNING"),
            "issues": [
                {
                    "rule": i.get("rule"),
                    "severity": i.get("severity"),
                    "message": i.get("message"),
                    "table": (i.get("context") or {}).get("table"),
                    "column": (i.get("context") or {}).get("column"),
                }
                for i in issues
            ],
        })

    table_details = {
        _qualified(t["schema"], t["name"]): {
            "schema": t["schema"],
            "name": t["name"],
            "columns": len(t["columns"]),
            "row_count": t.get("row_count"),
            "primary_key": t["primary_key"],
            "keys_declared": t.get("keys_declared", False),
            "foreign_keys": [
                {
                    "name": fk["name"],
                    "columns": fk["columns"],
                    "references": _qualified(fk["references_schema"], fk["references_table"]),
                    "references_columns": fk["references_columns"],
                }
                for fk in t["foreign_keys"]
            ],
        }
        for t in tables
    }

    report = {
        "status": "success",
        "decision": decision,
        "next_step": layer_result.get("next_step"),
        "compliance_score": compliance_score,
        "score_basis": "Share of rules passing (pass = 1, warning = 0.5, fail = 0).",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "duration_ms": duration_ms,
        "source": source,
        "summary": {
            "tables": len(tables),
            "views": len(normalized["views"]),
            "procedures": len(normalized["procedures"]),
            "columns": sum(len(t["columns"]) for t in tables),
            "errors": summary.get("total_errors", 0),
            "warnings": summary.get("total_warnings", 0),
        },
        "keys": {
            "declared": keys_known,
            "tables_with_pk": len(with_pk),
            "tables_checked": len(known_tables),
            "tables_without_pk": without_pk[:MAX_LISTED_OBJECTS],
            "pk_coverage": pk_coverage,
            "fk_total": fk_total,
            "fk_valid": fk_valid,
            "fk_out_of_scope": len(fk_out_of_scope),
            "fk_broken": len(fk_broken),
            "fk_integrity": fk_integrity,
        },
        "type_findings": type_findings,
        "unsupported_types": unsupported_count,
        "sensitive_columns": sensitive,
        "destructive_statements": destructive,
        "metrics": metrics,
        "rules": rules,
        "sections": sections,
        "tables": table_details,
        "remediations": _remediation_sql(tables, type_findings, fk_broken, fk_out_of_scope),
        "logs": _log_lines(layer_result, source, normalized, rules, compliance_score, duration_ms),
    }
    return report


def _remediation_sql(tables, type_findings, fk_broken, fk_out_of_scope) -> str:
    """Fabric Warehouse DDL for this schema: keys are NOT ENFORCED in Fabric."""
    skip_fks = {
        (i["context"].get("table"), i["context"].get("fk"))
        for i in fk_broken + fk_out_of_scope
    }
    lines = ["-- Microsoft Fabric Warehouse constraint preservation (keys are metadata only: NOT ENFORCED)"]

    pk_lines = []
    for t in tables:
        if t.get("primary_key"):
            cols = ", ".join(_quote(c) for c in t["primary_key"])
            pk_lines.append(
                f"ALTER TABLE {_quote(t['schema'])}.{_quote(t['name'])} ADD CONSTRAINT "
                f"{_quote('PK_' + t['name'])} PRIMARY KEY NONCLUSTERED ({cols}) NOT ENFORCED;"
            )
    lines += pk_lines or ["-- No declared primary keys to preserve."]

    fk_lines = []
    for t in tables:
        for fk in t["foreign_keys"]:
            if (t["name"], fk["name"]) in skip_fks or not fk["columns"] or not fk["references_columns"]:
                continue
            ref = f"{_quote(fk['references_schema'])}.{_quote(fk['references_table'])}" if fk["references_schema"] else _quote(fk["references_table"])
            fk_lines.append(
                f"ALTER TABLE {_quote(t['schema'])}.{_quote(t['name'])} ADD CONSTRAINT {_quote(fk['name'] or 'FK_' + t['name'])} "
                f"FOREIGN KEY ({', '.join(_quote(c) for c in fk['columns'])}) "
                f"REFERENCES {ref} ({', '.join(_quote(c) for c in fk['references_columns'])}) NOT ENFORCED;"
            )
    lines += [""] + (fk_lines or ["-- No verifiable foreign keys to preserve."])

    no_pk = [t for t in tables if t.get("keys_declared") and not t.get("primary_key")]
    if no_pk:
        lines += ["", "-- Tables without a primary key: choose a business key before loading to avoid duplicate rows"]
        lines += [f"--   {_qualified(t['schema'], t['name'])}" for t in no_pk[:MAX_LISTED_OBJECTS]]

    if type_findings:
        lines += ["", "-- Column type changes for Fabric"]
        lines += [
            f"--   {f['table']}.{f['column']}: {f['source_type']} -> {f['fabric_type']}"
            for f in type_findings[:MAX_LISTED_OBJECTS * 2]
        ]
    return "\n".join(lines)


def _log_lines(layer_result, source, normalized, rules, score, duration_ms) -> list[dict]:
    """Ordered, levelled log lines the Constraint Agent streams into its console."""
    now = datetime.now().strftime("%H:%M:%S")
    logs: list[dict] = []

    def add(level: str, text: str, step: str = ""):
        logs.append({"time": now, "level": level, "step": step, "text": text})

    origin_text = {
        "live": "live extraction from the connected source",
        "demo": "demo catalog (Demo Simulation Mode)",
        "catalog_fallback": "built-in catalog (live extraction failed, see Discovery Agent)",
    }.get(source.get("metadata_origin"), "cached metadata")

    add("INFO", f"Constraint Agent run started for {source.get('platform')} "
                f"{source.get('server') or ''} / {source.get('database') or ''}".strip())
    add("INFO", f"Metadata source: {origin_text}")
    add("INFO", f"Scope: {len(normalized['tables'])} tables, {len(normalized['views'])} views, "
                f"{len(normalized['procedures'])} procedures")

    sections = layer_result.get("sections", [])
    for idx, section in enumerate(sections, start=1):
        name = section.get("section")
        step = f"{idx}/{len(sections)}"
        issues = section.get("issues", [])
        errors = sum(1 for i in issues if i.get("severity") == "ERROR")
        warnings = len(issues) - errors
        add("STEP", f"{SECTION_TITLES.get(name, name)}", step)
        for issue in issues[:MAX_LISTED_OBJECTS]:
            add("ERROR" if issue.get("severity") == "ERROR" else "WARN",
                f"{issue.get('rule')}: {issue.get('message')}", step)
        if len(issues) > MAX_LISTED_OBJECTS:
            add("INFO", f"... {len(issues) - MAX_LISTED_OBJECTS} more finding(s) in this section", step)
        verdict = "PASS" if section.get("passed") else "FAIL"
        add("PASS" if section.get("passed") else "FAIL",
            f"{SECTION_TITLES.get(name, name)}: {verdict} ({errors} error(s), {warnings} warning(s))", step)

    for rule in rules:
        add({"pass": "PASS", "warn": "WARN", "fail": "FAIL", "info": "INFO"}[rule["status"]],
            f"{rule['id']} {rule['desc']}", "rules")

    decision = layer_result.get("decision")
    summary = layer_result.get("summary", {})
    add("RESULT", f"Gate decision: {decision} - {summary.get('total_errors', 0)} error(s), "
                  f"{summary.get('total_warnings', 0)} warning(s), compliance score {score}% "
                  f"(completed in {duration_ms} ms)")
    add("INFO", f"Next step: {layer_result.get('next_step')}")
    return logs
