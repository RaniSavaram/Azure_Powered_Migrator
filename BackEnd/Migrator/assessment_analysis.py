"""
Assessment Agent (Phase 3) analysis: migration readiness, complexity,
load strategy and migration waves for every scanned table.

Built on the same inputs as the rest of the pipeline - the extracted
metadata (with declared keys), the sizing dataframes from
metadataProcessor, and the Constraint Agent's Layer 1 report - so every
figure here traces back to the source schema. Scores are deterministic and
each table carries the factors that produced its score.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime
from typing import Any

from HarnessLayers.layer1.Layer import _normalize_extracted_metadata

# Direct Lake row guardrail per table on an F64 capacity. Smaller SKUs have
# lower limits, so this is reported as "within F64 guardrail", not as a
# general guarantee.
DIRECT_LAKE_F64_MAX_ROWS = 1_500_000_000

# Below this, a full reload each run is simpler than incremental loading.
INCREMENTAL_MIN_ROWS = 1_000_000

# OneLake Delta/Parquet (V-Order) size relative to source. Same planning
# factor the Discovery Agent reports; an estimate, not a measurement.
ONELAKE_COMPRESSION_FACTOR = 0.24

WATERMARK_NAME = re.compile(
    r"(modif|updat|chang|last_?upd|lastmod|etl|load_?(date|time|ts)|_ts$|^ts_|timestamp|created|inserted|rowversion)",
    re.IGNORECASE,
)
DATETIME_TYPES = ("date", "time", "timestamp", "rowversion")

TIER_LIMITS = (("Simple", 25), ("Medium", 50))


def _qualified(schema: str | None, name: str | None) -> str:
    return f"{schema}.{name}" if schema else (name or "")


def _tier(score: int) -> str:
    for tier, limit in TIER_LIMITS:
        if score < limit:
            return tier
    return "Complex"


def _volume_points(rows: int, size_mb: float) -> int:
    row_pts = 0 if rows < 100_000 else 10 if rows < 2_000_000 else 20 if rows < 50_000_000 else 30
    size_pts = 0 if size_mb < 50 else 5 if size_mb < 500 else 10 if size_mb < 5_000 else 15
    return min(40, row_pts + size_pts)


def _watermark_candidates(columns: list[dict], platform_slug: str) -> list[str]:
    found = []
    for col in columns:
        name = col.get("name") or ""
        dtype = (col.get("data_type") or "").lower()
        is_time = any(t in dtype for t in DATETIME_TYPES)
        if platform_slug in ("sqlserver", "synapse") and dtype.startswith("timestamp"):
            found.append(name)  # rowversion: ideal for change detection
        elif is_time and WATERMARK_NAME.search(name):
            found.append(name)
    return found


def _waves(tables: dict[str, dict], edges: list[tuple[str, str]]) -> tuple[list[list[str]], list[str]]:
    """
    Orders tables so every table loads after the tables it references
    (Kahn's algorithm). Returns (waves, tables_in_cycles); tables that are
    part of a reference cycle go in a final wave of their own.
    """
    deps: dict[str, set[str]] = {t: set() for t in tables}
    for child, parent in edges:
        if child in deps and parent in deps and child != parent:
            deps[child].add(parent)

    remaining = dict(deps)
    waves: list[list[str]] = []
    while remaining:
        ready = sorted(t for t, d in remaining.items() if not (d & remaining.keys()))
        if not ready:
            break
        waves.append(ready)
        for t in ready:
            remaining.pop(t)
    cycles = sorted(remaining)
    if cycles:
        waves.append(cycles)
    return waves, cycles


def build_assessment(
    raw_metadata: dict,
    dataframes: tuple | list,
    constraints: dict | None,
    source: dict,
) -> dict[str, Any]:
    platform_slug = (source.get("platform_slug") or "").lower()
    normalized = _normalize_extracted_metadata(raw_metadata or {})
    norm_tables = normalized["tables"]

    stats_df = dataframes[2] if dataframes and len(dataframes) > 2 else None
    dep_df = dataframes[-1] if dataframes else None

    stats: dict[tuple[str, str], tuple[int, float]] = {}
    if stats_df is not None and not stats_df.empty:
        for _, r in stats_df.iterrows():
            stats[(str(r.get("schema_name")), str(r.get("table_name")))] = (
                int(r.get("row_count") or 0),
                float(r.get("size_mb") or 0.0),
            )

    # Phase 2 findings, keyed by table name (Layer 1 issues carry the bare name).
    constraints = constraints or {}
    type_changes: dict[str, list[dict]] = defaultdict(list)
    for f in constraints.get("type_findings") or []:
        type_changes[f.get("table")].append(f)
    sensitive: dict[str, list[str]] = defaultdict(list)
    for s in constraints.get("sensitive_columns") or []:
        sensitive[s.get("table")].append(s.get("column"))
    blocking: dict[str, list[str]] = defaultdict(list)
    for section in ((constraints.get("harness_result") or {}).get("sections") or []):
        for issue in section.get("issues") or []:
            table = (issue.get("context") or {}).get("table")
            if issue.get("severity") == "ERROR" and table:
                blocking[table].append(issue.get("message"))

    # Dependencies: declared foreign keys first; fall back to the
    # name-based dependencies metadataProcessor infers.
    by_name = {t["name"]: _qualified(t["schema"], t["name"]) for t in norm_tables}
    declared_edges = [
        (_qualified(t["schema"], t["name"]),
         _qualified(fk["references_schema"] or t["schema"], fk["references_table"]))
        for t in norm_tables for fk in t["foreign_keys"]
    ]
    dependency_source = "declared" if declared_edges else "none"
    edges = declared_edges
    if not edges and dep_df is not None and not dep_df.empty:
        edges = [
            (_qualified(r.get("parent_schema"), r.get("parent_table")),
             _qualified(r.get("referenced_schema"), r.get("referenced_table")))
            for _, r in dep_df.iterrows()
        ]
        dependency_source = "inferred" if edges else "none"

    referenced_by: dict[str, int] = defaultdict(int)
    references: dict[str, set[str]] = defaultdict(set)
    for child, parent in edges:
        references[child].add(parent)
        referenced_by[parent] += 1

    tables: dict[str, dict] = {}
    for t in norm_tables:
        key = _qualified(t["schema"], t["name"])
        rows, size_mb = stats.get((t["schema"], t["name"]), (int(t.get("row_count") or 0), 0.0))
        columns = t["columns"]
        changes = type_changes.get(t["name"], [])
        pii = sensitive.get(t["name"], [])
        rel_count = len(references.get(key, set())) + referenced_by.get(key, 0)

        factors = []
        vol = _volume_points(rows, size_mb)
        if vol:
            factors.append({"factor": f"Volume ({rows:,} rows, {round(size_mb, 1)} MB)", "points": vol})
        if len(columns) > 50:
            factors.append({"factor": f"Wide table ({len(columns)} columns)", "points": 10})
        elif len(columns) > 20:
            factors.append({"factor": f"{len(columns)} columns", "points": 5})
        if changes:
            factors.append({"factor": f"{len(changes)} column type change(s) for Fabric", "points": min(15, 5 * len(changes))})
        if t.get("keys_declared") and not t["primary_key"]:
            factors.append({"factor": "No primary key", "points": 10})
        elif not t.get("keys_declared"):
            factors.append({"factor": "Keys unknown (catalog not readable)", "points": 5})
        if rel_count:
            factors.append({"factor": f"{rel_count} relationship(s)", "points": min(10, 2 * rel_count)})
        if pii:
            factors.append({"factor": f"{len(pii)} sensitive column(s)", "points": 5})
        score = min(100, sum(f["points"] for f in factors))

        if blocking.get(t["name"]):
            readiness = "blocked"
        elif changes or pii or (t.get("keys_declared") and not t["primary_key"]):
            readiness = "needs_review"
        else:
            readiness = "ready"

        watermarks = _watermark_candidates(columns, platform_slug)
        if rows < INCREMENTAL_MIN_ROWS:
            load_strategy = "Full load"
        elif watermarks:
            load_strategy = f"Incremental on {watermarks[0]}"
        else:
            load_strategy = "Full load (no watermark column; consider CDC)"

        tables[key] = {
            "key": key,
            "schema": t["schema"],
            "name": t["name"],
            "row_count": rows,
            "size_mb": round(size_mb, 2),
            "columns": len(columns),
            "primary_key": t["primary_key"],
            "keys_declared": bool(t.get("keys_declared")),
            "references": sorted(references.get(key, set())),
            "referenced_by": referenced_by.get(key, 0),
            "type_changes": [
                {"column": c["column"], "source_type": c["source_type"], "fabric_type": c["fabric_type"]} for c in changes
            ],
            "sensitive_columns": pii,
            "watermark_candidates": watermarks,
            "load_strategy": load_strategy,
            "direct_lake_ready": rows <= DIRECT_LAKE_F64_MAX_ROWS,
            "complexity_score": score,
            "complexity": _tier(score),
            "score_factors": factors,
            "readiness": readiness,
            "blocking_issues": blocking.get(t["name"], [])[:5],
        }

    waves, cycles = _waves(tables, edges)
    for idx, wave in enumerate(waves, start=1):
        for key in wave:
            tables[key]["wave"] = idx

    tier_counts = {"Simple": 0, "Medium": 0, "Complex": 0}
    readiness_counts = {"ready": 0, "needs_review": 0, "blocked": 0}
    for t in tables.values():
        tier_counts[t["complexity"]] += 1
        readiness_counts[t["readiness"]] += 1

    total_rows = sum(t["row_count"] for t in tables.values())
    total_size = round(sum(t["size_mb"] for t in tables.values()), 2)
    ranked_size = sorted(tables.values(), key=lambda t: t["size_mb"], reverse=True)
    ranked_rows = sorted(tables.values(), key=lambda t: t["row_count"], reverse=True)
    incremental = [t["key"] for t in tables.values() if t["load_strategy"].startswith("Incremental")]
    over_guardrail = [t["key"] for t in tables.values() if not t["direct_lake_ready"]]

    constraints_gate = constraints.get("decision") or "NOT_RUN"
    readiness_pct = round(100.0 * readiness_counts["ready"] / len(tables), 1) if tables else 0.0

    summary = {
        "total_tables": len(tables),
        "total_views": len(normalized["views"]),
        "total_procedures": len(normalized["procedures"]),
        "total_columns": sum(t["columns"] for t in tables.values()),
        "total_rows": total_rows,
        "total_size_mb": total_size,
        "est_onelake_size_mb": round(total_size * ONELAKE_COMPRESSION_FACTOR, 2),
        "complexity_breakdown": {k.lower(): v for k, v in tier_counts.items()},
        "readiness_breakdown": readiness_counts,
        "readiness_pct": readiness_pct,
        "wave_count": len(waves),
        "dependency_source": dependency_source,
        "tables_in_cycles": cycles,
        "incremental_candidates": len(incremental),
        "direct_lake_over_guardrail": over_guardrail,
        "constraints_gate": constraints_gate,
        "top_tables_by_size": [f"{i + 1}. {t['key']} ({t['size_mb']} MB)" for i, t in enumerate(ranked_size[:5])],
        "top_tables_by_rows": [f"{i + 1}. {t['key']} ({t['row_count']:,} rows)" for i, t in enumerate(ranked_rows[:5])],
    }

    if constraints_gate == "FAIL" or readiness_counts["blocked"]:
        verdict = "blocked"
    elif readiness_counts["needs_review"]:
        verdict = "ready_with_review"
    else:
        verdict = "ready"

    return {
        "summary": summary,
        "verdict": verdict,
        "tables": tables,
        "waves": [{"wave": i + 1, "tables": w} for i, w in enumerate(waves)],
        "metrics": [
            {"label": "Tables Ready", "value": f"{readiness_counts['ready']}/{len(tables)}",
             "color": "#16a34a" if readiness_counts["ready"] == len(tables) else "#f97316"},
            {"label": "Complexity", "value": f"{tier_counts['Simple']}S / {tier_counts['Medium']}M / {tier_counts['Complex']}C"},
            {"label": "Migration Waves", "value": str(len(waves))},
            {"label": "Source Volume", "value": f"{total_size:,} MB"},
        ],
        "logs": _logs(source, summary, tables, waves, cycles, dependency_source, verdict),
    }


def _logs(source, summary, tables, waves, cycles, dependency_source, verdict) -> list[dict]:
    now = datetime.now().strftime("%H:%M:%S")
    logs: list[dict] = []

    def add(level, text, step=""):
        logs.append({"time": now, "level": level, "step": step, "text": text})

    add("INFO", f"Assessment started for {source.get('platform')} {source.get('database') or ''}".strip())
    add("STEP", "Sizing profile", "1/5")
    add("INFO", f"{summary['total_tables']} tables, {summary['total_columns']} columns, "
                f"{summary['total_rows']:,} rows, {summary['total_size_mb']:,} MB "
                f"(~{summary['est_onelake_size_mb']:,} MB in OneLake, estimated)", "1/5")
    for line in summary["top_tables_by_size"][:3]:
        add("INFO", f"Largest: {line}", "1/5")

    add("STEP", "Phase 2 constraint findings", "2/5")
    gate = summary["constraints_gate"]
    add("PASS" if gate == "PASS" else ("FAIL" if gate == "FAIL" else "WARN"), f"Constraint gate: {gate}", "2/5")

    add("STEP", "Complexity scoring", "3/5")
    for t in sorted(tables.values(), key=lambda x: x["complexity_score"], reverse=True)[:5]:
        add("WARN" if t["complexity"] == "Complex" else "INFO",
            f"{t['key']}: {t['complexity']} ({t['complexity_score']}/100)", "3/5")
    cb = summary["complexity_breakdown"]
    add("PASS", f"Tiers: {cb['simple']} simple, {cb['medium']} medium, {cb['complex']} complex", "3/5")

    add("STEP", "Readiness & load strategy", "4/5")
    rb = summary["readiness_breakdown"]
    for t in [t for t in tables.values() if t["readiness"] == "blocked"][:10]:
        add("ERROR", f"{t['key']}: blocked - {t['blocking_issues'][0] if t['blocking_issues'] else 'Layer 1 error'}", "4/5")
    add("INFO", f"{summary['incremental_candidates']} table(s) can load incrementally", "4/5")
    if summary["direct_lake_over_guardrail"]:
        add("WARN", f"{len(summary['direct_lake_over_guardrail'])} table(s) exceed the F64 Direct Lake row guardrail", "4/5")
    add("FAIL" if rb["blocked"] else "PASS",
        f"Readiness: {rb['ready']} ready, {rb['needs_review']} need review, {rb['blocked']} blocked", "4/5")

    add("STEP", "Migration waves", "5/5")
    add("INFO", f"Dependencies: {dependency_source}", "5/5")
    for idx, wave in enumerate(waves, start=1):
        preview = ", ".join(wave[:6]) + (f" +{len(wave) - 6} more" if len(wave) > 6 else "")
        add("INFO", f"Wave {idx} ({len(wave)} tables): {preview}", "5/5")
    if cycles:
        add("WARN", f"{len(cycles)} table(s) reference each other in a cycle; loaded together in the last wave", "5/5")

    add("RESULT", {
        "ready": "Assessment complete: all tables ready for migration",
        "ready_with_review": "Assessment complete: ready, with tables that need review",
        "blocked": "Assessment complete: blocked until constraint errors are fixed",
    }[verdict])
    return logs
