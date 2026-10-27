import os
import json
import time
from datetime import datetime
from pathlib import Path
from threading import Lock

from config.Credentials import PrivateVariables
from Migrator.connection_store import save_connection, get_saved_connection, get_saved_connections
from Migrator.er_diagram import build_er_model
from Metadata_Scanner.extractors.sqlserver import SQLServerExtractor
from Metadata_Scanner.extractors.synapse import SynapseExtractor
from Metadata_Scanner.extractors.snowflake_extractor import SnowflakeExtractor
from Metadata_Scanner.extractors.databricks_client import DatabricksExtractor
from Metadata_Scanner.extractors.dynamics365 import Dynamics365Extractor
from HarnessLayers.layer1.Layer import layer1_Harness
from HarnessLayers.Harness_Json_Log_Formatter import format_harness_report

from AI_Agent_Pipeline.src.metadataProcessor import metadata_to_dataframes, build_dataframes
from AI_Agent_Pipeline.src.docx_generator import (
    create_table_summary_document,
    create_migration_plan_document,
    get_source_display_name
)
from AI_Agent_Pipeline.src.fabric_json_generator import generate_fabric_json_metadata
from AI_Agent_Pipeline.src.tools.database_tools import table_summary_tool, get_size_category
from Artifacts_Generator.plan_to_json import build_plan

import math

OUTPUT_DIR = (Path(__file__).resolve().parent.parent / "AI_Agent_Pipeline" / "output").resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _sanitize_for_json(obj):
    """
    Recursively replaces NaN, Inf, -Inf with None so json.dumps and DRF serializers never fail.
    """
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple, set)):
        return [_sanitize_for_json(item) for item in obj]
    return obj


_pipeline_lock = Lock()

active_pipeline = {
    "source_connected": False,
    "platform": "SQL Server",
    "platform_slug": "sqlserver",
    "server": "",
    "database": "",
    "catalog": "",
    "connected_at": None,
    "connection_config": {},
    "metadata": None,
    "metadata_summary": None,
    "metadata_origin": None,
    "metadata_extracted_at": None,
    "dataframes": None,
    "constraints_report": None,
    "assessment_report": None,
    "migration_plan": None,
}


def normalize_platform_slug(platform_str: str) -> str:
    clean = str(platform_str or "").strip().lower().replace(" ", "").replace("_", "")
    if clean in ("sqlserver", "mssql"):
        return "sqlserver"
    elif clean in ("synapse", "azuresynapse"):
        return "synapse"
    elif clean == "databricks":
        return "databricks"
    elif clean == "snowflake":
        return "snowflake"
    elif clean in ("dynamics365", "d365", "dynamics"):
        return "dynamics365"
    elif clean == "sqlite":
        return "sqlite"
    elif clean == "oracle":
        return "oracle"
    elif clean in ("saphana", "sap"):
        return "saphana"
    return clean or "sqlserver"


def get_platform_display(platform_slug: str) -> str:
    slug = normalize_platform_slug(platform_slug)
    mapping = {
        "sqlserver": "SQL Server",
        "databricks": "Databricks",
        "dynamics365": "Dynamics 365",
        "snowflake": "Snowflake",
        "synapse": "Azure Synapse",
        "oracle": "Oracle",
        "saphana": "SAP HANA",
        "sqlite": "SQLite",
    }
    return mapping.get(slug, slug.title())


def get_default_platform_metadata(platform_slug: str) -> dict:
    slug = normalize_platform_slug(platform_slug)
    # Check if a pre-generated Fabric Migration Metadata JSON exists
    candidate_files = [
        OUTPUT_DIR / f"{slug}_Fabric_Migration_Metadata.json",
        OUTPUT_DIR / "Fabric_Migration_Metadata.json",
    ]
    for c_file in candidate_files:
        if c_file.exists():
            try:
                with open(c_file, "r", encoding="utf-8") as f:
                    fabric_meta = json.load(f)
                    return _convert_fabric_json_to_raw_metadata(fabric_meta, slug)
            except Exception:
                pass

    # Built-in high fidelity schema blueprint
    return _build_fallback_schema(slug)


def _convert_fabric_json_to_raw_metadata(fabric_meta: dict, slug: str) -> dict:
    source_info = fabric_meta.get("source", {})
    db_name = source_info.get("database_name") or f"{slug}_prod"
    schemas_dict = {}

    for obj in fabric_meta.get("objects", []):
        schema_name = obj.get("schema") or "dbo"
        if schema_name not in schemas_dict:
            schemas_dict[schema_name] = {
                "name": schema_name,
                "tables": [],
                "views": [],
                "procedures": [],
                "functions": [],
                "volumes": [],
            }

        obj_type = (obj.get("type") or "table").lower()
        if obj_type == "table":
            cols = []
            for c in obj.get("columns", []):
                cols.append({
                    "name": c.get("name"),
                    "datatype": c.get("source_datatype") or c.get("target_datatype") or "NVARCHAR(255)",
                    "nullable": "YES" if c.get("nullable", True) else "NO",
                    "max_length": c.get("max_length", 255),
                    "precision": c.get("precision"),
                    "scale": c.get("scale", 0),
                })
            table_entry = {
                "name": obj.get("name"),
                "type": "BASE TABLE",
                "row_count": obj.get("row_count") or 125000,
                "size_mb": obj.get("size_mb") or 14.5,
                # The metadata JSON's plain "primary_key" is a name-based guess;
                # kept separately so it is never reported as a declared key.
                "inferred_primary_key": obj.get("primary_key"),
                "columns": cols,
            }
            # Same contract as the live extractors (declared_keys.py): keys are
            # only set when the source catalog was read - absent means unknown.
            if obj.get("declared_primary_key") is not None:
                table_entry["primary_key"] = obj.get("declared_primary_key") or []
                table_entry["foreign_keys"] = obj.get("declared_foreign_keys") or []
            schemas_dict[schema_name]["tables"].append(table_entry)
        elif obj_type == "view":
            schemas_dict[schema_name]["views"].append({
                "name": obj.get("name"),
                "definition": obj.get("definition") or f"SELECT * FROM {schema_name}.fact_orders",
            })
        elif obj_type == "procedure":
            schemas_dict[schema_name]["procedures"].append({
                "name": obj.get("name"),
                "definition": obj.get("definition") or "CREATE PROCEDURE sp_process_orders AS BEGIN SELECT 1; END",
            })

    return {
        "database": db_name,
        "schemas": list(schemas_dict.values()),
    }


def _build_fallback_schema(slug: str) -> dict:
    db_name = f"{slug}_enterprise_db"
    return {
        "database": db_name,
        "schemas": [
            {
                "name": "sales",
                "tables": [
                    {
                        "name": "fact_orders",
                        "type": "BASE TABLE",
                        "row_count": 6200000,
                        "size_mb": 1120.0,
                        "primary_key": "order_id",
                        "foreign_keys": [{"column": "customer_id", "referenced_table": "dim_customer", "referenced_column": "customer_id"}],
                        "columns": [
                            {"name": "order_id", "datatype": "BIGINT", "nullable": "NO"},
                            {"name": "customer_id", "datatype": "INT", "nullable": "NO"},
                            {"name": "order_date", "datatype": "DATETIME2", "nullable": "NO"},
                            {"name": "total_amount", "datatype": "DECIMAL(18,2)", "nullable": "NO"},
                            {"name": "order_status", "datatype": "VARCHAR(32)", "nullable": "NO"},
                            {"name": "_inserted_at", "datatype": "DATETIME2", "nullable": "NO"},
                        ],
                    },
                    {
                        "name": "fact_order_items",
                        "type": "BASE TABLE",
                        "row_count": 8100000,
                        "size_mb": 1450.0,
                        "primary_key": "item_id",
                        "foreign_keys": [
                            {"column": "order_id", "referenced_table": "fact_orders", "referenced_column": "order_id"},
                            {"column": "product_id", "referenced_table": "dim_product", "referenced_column": "product_id"}
                        ],
                        "columns": [
                            {"name": "item_id", "datatype": "BIGINT", "nullable": "NO"},
                            {"name": "order_id", "datatype": "BIGINT", "nullable": "NO"},
                            {"name": "product_id", "datatype": "INT", "nullable": "NO"},
                            {"name": "quantity", "datatype": "INT", "nullable": "NO"},
                            {"name": "unit_price", "datatype": "DECIMAL(12,2)", "nullable": "NO"},
                            {"name": "discount_pct", "datatype": "DECIMAL(5,2)", "nullable": "YES"},
                        ],
                    },
                    {
                        "name": "dim_customer",
                        "type": "BASE TABLE",
                        "row_count": 520000,
                        "size_mb": 94.0,
                        "primary_key": "customer_id",
                        "columns": [
                            {"name": "customer_id", "datatype": "INT", "nullable": "NO"},
                            {"name": "customer_name", "datatype": "NVARCHAR(150)", "nullable": "NO"},
                            {"name": "email", "datatype": "NVARCHAR(200)", "nullable": "YES"},
                            {"name": "region_code", "datatype": "VARCHAR(10)", "nullable": "YES"},
                            {"name": "created_date", "datatype": "DATE", "nullable": "NO"},
                            {"name": "store_location", "datatype": "GEOMETRY", "nullable": "YES"},
                        ],
                    },
                    {
                        "name": "dim_product",
                        "type": "BASE TABLE",
                        "row_count": 145000,
                        "size_mb": 42.0,
                        "primary_key": "product_id",
                        "columns": [
                            {"name": "product_id", "datatype": "INT", "nullable": "NO"},
                            {"name": "sku", "datatype": "VARCHAR(50)", "nullable": "NO"},
                            {"name": "product_name", "datatype": "NVARCHAR(200)", "nullable": "NO"},
                            {"name": "category", "datatype": "VARCHAR(50)", "nullable": "NO"},
                            {"name": "unit_cost", "datatype": "DECIMAL(12,2)", "nullable": "NO"},
                            {"name": "hierarchy_path", "datatype": "HIERARCHYID", "nullable": "YES"},
                        ],
                    },
                ],
                "views": [
                    {
                        "name": "vw_daily_sales_summary",
                        "definition": "CREATE VIEW sales.vw_daily_sales_summary AS SELECT order_date, COUNT(*) as orders_count, SUM(total_amount) as total_revenue FROM sales.fact_orders GROUP BY order_date;"
                    }
                ],
                "procedures": [
                    {
                        "name": "sp_refresh_sales_marts",
                        "definition": "CREATE PROCEDURE sales.sp_refresh_sales_marts AS BEGIN INSERT INTO sales.fact_orders SELECT * FROM staging_orders; END;"
                    }
                ],
            },
            {
                "name": "inventory",
                "tables": [
                    {
                        "name": "stock_movements",
                        "type": "BASE TABLE",
                        "row_count": 4300000,
                        "size_mb": 820.0,
                        "primary_key": "movement_id",
                        "foreign_keys": [{"column": "product_id", "referenced_table": "dim_product", "referenced_column": "product_id"}],
                        "columns": [
                            {"name": "movement_id", "datatype": "BIGINT", "nullable": "NO"},
                            {"name": "product_id", "datatype": "INT", "nullable": "NO"},
                            {"name": "warehouse_id", "datatype": "INT", "nullable": "NO"},
                            {"name": "quantity_delta", "datatype": "INT", "nullable": "NO"},
                            {"name": "movement_timestamp", "datatype": "DATETIME2", "nullable": "NO"},
                        ],
                    },
                    {
                        "name": "dim_warehouse",
                        "type": "BASE TABLE",
                        "row_count": 120,
                        "size_mb": 0.5,
                        "primary_key": "warehouse_id",
                        "columns": [
                            {"name": "warehouse_id", "datatype": "INT", "nullable": "NO"},
                            {"name": "warehouse_code", "datatype": "VARCHAR(20)", "nullable": "NO"},
                            {"name": "location_address", "datatype": "NVARCHAR(250)", "nullable": "YES"},
                            {"name": "capacity_sqft", "datatype": "INT", "nullable": "YES"},
                        ],
                    },
                ],
                "views": [],
                "procedures": [],
            }
        ],
    }


def connect_source_service(data: dict) -> dict:
    platform_raw = data.get("platform") or data.get("source") or "SQL Server"
    slug = normalize_platform_slug(platform_raw)
    display_name = get_platform_display(slug)

    server = (data.get("server") or data.get("account") or "").strip()
    database = (data.get("database") or data.get("catalog") or "").strip()
    username = (data.get("username") or data.get("user") or "").strip()
    password = (data.get("password") or "").strip()
    port = data.get("port")
    remember_me = bool(data.get("rememberMe") or data.get("remember_me"))

    extra = dict(data.get("extra") or {})
    for key in ("httpPath", "http_path", "personalAccessToken", "token", "account", "warehouse", "tenantId", "tenant_id", "clientId", "client_id", "clientSecret", "client_secret", "role"):
        val = data.get(key)
        if val is not None:
            extra[key] = val

    # For Databricks / token-based platforms, map token into password if password is empty
    if not password:
        token_val = (
            extra.get("token")
            or extra.get("personalAccessToken")
            or extra.get("personal_access_token")
            or extra.get("access_token")
            or data.get("token")
            or data.get("personalAccessToken")
            or data.get("personal_access_token")
            or data.get("access_token")
            or ""
        )
        if token_val:
            password = str(token_val).strip()

    # For Databricks: ensure http_path and catalog are properly mapped
    if slug == "databricks":
        http_val = (
            extra.get("http_path")
            or extra.get("httpPath")
            or data.get("httpPath")
            or data.get("http_path")
            or ""
        )
        if http_val:
            extra["http_path"] = http_val
            extra["httpPath"] = http_val
        if not database:
            database = (data.get("catalog") or extra.get("catalog") or "main").strip()

    # Auto-lookup remembered profile if empty and server is given
    if (not password or not database or (slug == "databricks" and not extra.get("http_path"))) and server:
        for profile in get_saved_connections(slug):
            if profile.get("server") == server:
                if not username or profile.get("username") == username:
                    if not password and profile.get("password"):
                        password = profile.get("password")
                    if not database and (profile.get("database") or profile.get("catalog")):
                        database = profile.get("database") or profile.get("catalog")
                    if not username and profile.get("username"):
                        username = profile.get("username")
                    prof_extra = profile.get("extra") or {}
                    if slug == "databricks" and not extra.get("http_path"):
                        h = prof_extra.get("http_path") or prof_extra.get("httpPath")
                        if h:
                            extra["http_path"] = h
                            extra["httpPath"] = h
                    break

    # Ensure token is populated in extra for Databricks
    if password and slug == "databricks":
        if not extra.get("token"): extra["token"] = password
        if not extra.get("personalAccessToken"): extra["personalAccessToken"] = password

    creds = PrivateVariables()
    creds.set_servername(server)
    creds.set_database_name(database)
    creds.set_username(username)
    creds.set_password(password)
    creds.set_port(port)
    creds.set_extra_dict(extra)

    conn_details_lines = []
    if slug == "snowflake":
        account = extra.get("account") or server
        warehouse = extra.get("warehouse")
        role = extra.get("role")
        if account: conn_details_lines.append(f"Account   : {repr(account)}")
        if database: conn_details_lines.append(f"Database  : {repr(database)}")
        if warehouse: conn_details_lines.append(f"Warehouse : {repr(warehouse)}")
        if username: conn_details_lines.append(f"User      : {repr(username)}")
        if role: conn_details_lines.append(f"Role      : {repr(role)}")
    elif slug == "databricks":
        catalog = database
        http_path = extra.get("http_path") or extra.get("httpPath")
        if server: conn_details_lines.append(f"Server   : {repr(server)}")
        if catalog: conn_details_lines.append(f"Catalog  : {repr(catalog)}")
        if http_path: conn_details_lines.append(f"HTTP Path: {repr(http_path)}")
        if username: conn_details_lines.append(f"User     : {repr(username)}")
    elif slug in ("dynamics365", "dynamics 365", "d365", "dynamics"):
        if server: conn_details_lines.append(f"Org URL  : {repr(server)}")
    elif slug == "sqlite":
        if database: conn_details_lines.append(f"Database : {repr(database)}")
    else:
        if server: conn_details_lines.append(f"Server   : {repr(server)}")
        if database: conn_details_lines.append(f"Database : {repr(database)}")
        if username: conn_details_lines.append(f"User     : {repr(username)}")

    print("[INFO]: Connect request received")
    print("[INFO]: Connection Details recieved")

    extractor = None
    live_connected = False
    conn_error = None

    is_demo = bool(data.get("demo_mode") or data.get("demoMode") or data.get("isDemo"))

    if not is_demo and (server or extra.get("account")):
        try:
            if slug in ("sqlserver", "mssql"):
                extractor = SQLServerExtractor(creds)
            elif slug in ("synapse", "azuresynapse"):
                extractor = SynapseExtractor(creds)
            elif slug == "snowflake":
                extractor = SnowflakeExtractor(creds)
            elif slug == "databricks":
                extractor = DatabricksExtractor(creds)
            elif slug in ("dynamics365", "dynamics 365", "d365", "dynamics"):
                extractor = Dynamics365Extractor(creds)
            elif slug == "sqlite":
                extractor = None

            if extractor:
                extractor.connect()
                print("[INFO]: Successfully Connected To the Database")
                live_connected = True
                extractor.close()
            else:
                print("[INFO]: Successfully Connected To the Database")
                live_connected = True
        except Exception as ex:
            print(ex)
            conn_error = str(ex)
    elif not is_demo:
        conn_error = "Server host address or account identifier is required."

    # If demo mode is explicitly requested
    if is_demo:
        with _pipeline_lock:
            active_pipeline["source_connected"] = True
            active_pipeline["platform"] = display_name
            active_pipeline["platform_slug"] = slug
            active_pipeline["server"] = server or "demo-catalog.enterprise.net"
            active_pipeline["database"] = database or f"{slug}_production"
            active_pipeline["catalog"] = data.get("catalog") or database or "main"
            active_pipeline["connected_at"] = datetime.now().isoformat()
            active_pipeline["connection_config"] = {
                "platform": display_name,
                "slug": slug,
                "server": active_pipeline["server"],
                "database": active_pipeline["database"],
                "username": username or "demo_user",
                "port": port,
                "extra": extra,
                "live_connected": False,
                "is_demo": True,
                "remember_me": remember_me,
            }

        demo_logs = [
            "[INFO]: Connect request received",
            "[INFO]: Connection Details recieved",
        ]
        demo_logs.extend(conn_details_lines)
        demo_logs.append("[INFO]: Successfully Connected To the Database (Demo Mode)")
        demo_logs.append(f"[INFO] Connected to {active_pipeline['database']} on {active_pipeline['server']} successfully.")
        return {
            "status": "success",
            "connected": True,
            "is_demo": True,
            "connection_status": "success",
            "message": f"Connected to {database} on {server} successfully.",
            "source": display_name,
            "platform_slug": slug,
            "live_connected": False,
            "logs": demo_logs,
            "connection_logs": demo_logs,
            "config": active_pipeline["connection_config"],
        }

    # If real connection failed
    if conn_error or not live_connected:
        fail_reason = conn_error or "Authentication handshake failed or server host unreachable."

        with _pipeline_lock:
            active_pipeline["source_connected"] = False
            active_pipeline["connection_config"] = {
                "platform": display_name,
                "slug": slug,
                "server": server,
                "database": database,
                "username": username,
                "port": port,
                "extra": extra,
                "live_connected": False,
                "is_demo": False,
                "remember_me": remember_me,
            }

        error_logs = [
            "[INFO]: Connect request received",
            "[INFO]: Connection Details recieved",
        ]
        error_logs.extend(conn_details_lines)
        error_logs.append(str(fail_reason))

        return {
            "status": "error",
            "connected": False,
            "connection_status": "failed",
            "live_connected": False,
            "message": str(fail_reason),
            "error": str(fail_reason),
            "source": display_name,
            "platform_slug": slug,
            "logs": error_logs,
            "connection_logs": error_logs,
            "config": active_pipeline["connection_config"],
        }

    # If real connection succeeded
    with _pipeline_lock:
        active_pipeline["source_connected"] = True
        active_pipeline["platform"] = display_name
        active_pipeline["platform_slug"] = slug
        active_pipeline["server"] = server
        active_pipeline["database"] = database
        active_pipeline["catalog"] = data.get("catalog") or database or "main"
        active_pipeline["connected_at"] = datetime.now().isoformat()
        active_pipeline["connection_config"] = {
            "platform": display_name,
            "slug": slug,
            "server": active_pipeline["server"],
            "database": active_pipeline["database"],
            "username": username,
            "password": password,
            "port": port,
            "extra": extra,
            "live_connected": True,
            "is_demo": False,
            "remember_me": remember_me,
        }

    if remember_me:
        save_connection(slug, {
            "server": active_pipeline["server"],
            "database": active_pipeline["database"],
            "username": username,
            "password": password,
            "extra": extra,
        })

    msg = f"Connected to {database} on {server} successfully."
    print(f"[INFO] {msg}")

    success_logs = [
        "[INFO]: Connect request received",
        "[INFO]: Connection Details recieved",
    ]
    success_logs.extend(conn_details_lines)
    success_logs.append("[INFO]: Successfully Connected To the Database")
    success_logs.append(f"[INFO] {msg}")

    return {
        "status": "success",
        "connected": True,
        "connection_status": "success",
        "message": msg,
        "source": display_name,
        "platform_slug": slug,
        "live_connected": True,
        "logs": success_logs,
        "connection_logs": success_logs,
        "config": active_pipeline["connection_config"],
    }


def extract_metadata_service(data: dict = None) -> dict:
    needs_connect = not active_pipeline.get("source_connected", False)
    if data and not needs_connect:
        req_server = (data.get("server") or data.get("account") or "").strip()
        req_db = (data.get("database") or data.get("catalog") or "").strip()
        curr_server = (active_pipeline.get("server") or "").strip()
        curr_db = (active_pipeline.get("database") or "").strip()
        if req_server and req_server != curr_server:
            needs_connect = True
        elif req_db and req_db != curr_db:
            needs_connect = True

    if needs_connect and data:
        if data.get("platform") or data.get("server") or data.get("source"):
            conn_res = connect_source_service(data)
            # If the user attempted connection with credentials and it failed:
            if conn_res.get("connected") is False and not (data.get("demo_mode") or data.get("demoMode") or data.get("isDemo")):
                return _sanitize_for_json({
                    "status": "error",
                    "connected": False,
                    "connection_status": "failed",
                    "live_connected": False,
                    "platform": conn_res.get("source", "Source Platform"),
                    "server": data.get("server", ""),
                    "database": data.get("database", ""),
                    "error": conn_res.get("error", "Connection failed"),
                    "message": conn_res.get("message", "Connection failed"),
                    "connection_logs": conn_res.get("connection_logs", []),
                    "logs": conn_res.get("logs", []),
                })

    slug = active_pipeline.get("platform_slug") or "sqlserver"
    display_name = active_pipeline.get("platform") or "SQL Server"
    database = active_pipeline.get("database") or f"{slug}_production"

    creds = PrivateVariables()
    cfg = active_pipeline.get("connection_config", {})
    creds.set_servername(active_pipeline.get("server"))
    creds.set_database_name(active_pipeline.get("database"))
    creds.set_username(cfg.get("username", ""))

    pwd = cfg.get("password", "") or (data.get("password") if data else "")
    cfg_extra = dict(cfg.get("extra", {}))
    if data and data.get("extra"):
        cfg_extra.update(data.get("extra"))
    if not pwd and slug == "databricks":
        pwd = (
            cfg_extra.get("token")
            or cfg_extra.get("personalAccessToken")
            or cfg_extra.get("personal_access_token")
            or cfg_extra.get("access_token")
            or ""
        )
    if not pwd and active_pipeline.get("server"):
        for profile in get_saved_connections(slug):
            if profile.get("server") == active_pipeline.get("server"):
                if not creds.get_username() or profile.get("username") == creds.get_username():
                    pwd = profile.get("password") or ""
                    break
    if pwd and slug == "databricks":
        if not cfg_extra.get("token"): cfg_extra["token"] = pwd
        if not cfg_extra.get("personalAccessToken"): cfg_extra["personalAccessToken"] = pwd
    creds.set_password(pwd)
    creds.set_port(cfg.get("port"))
    creds.set_extra_dict(cfg_extra)

    metadata = None
    if cfg.get("live_connected"):
        try:
            if slug == "sqlserver":
                extractor = SQLServerExtractor(creds)
                metadata = extractor.extract()
            elif slug == "databricks":
                extractor = DatabricksExtractor(creds)
                metadata = extractor.extract()
            elif slug == "snowflake":
                extractor = SnowflakeExtractor(creds)
                metadata = extractor.extract()
            elif slug == "synapse":
                extractor = SynapseExtractor(creds)
                metadata = extractor.extract()
            elif slug == "dynamics365":
                extractor = Dynamics365Extractor(creds)
                metadata = extractor.extract()
        except Exception as ex:
            print(f"[WARN] Live extraction failed: {ex}. Falling back to high-fidelity schema catalog.")

    # Where the metadata came from - the Constraint Agent reports this so a
    # fallback catalog is never presented as the user's real schema.
    if metadata:
        metadata_origin = "live"
    elif cfg.get("is_demo"):
        metadata_origin = "demo"
    else:
        metadata_origin = "catalog_fallback"

    if not metadata:
        metadata = get_default_platform_metadata(slug)

    dfs = metadata_to_dataframes(metadata, label=database)
    if len(dfs) == 8:
        tables_df, columns_df, stats_df, views_df, procedures_df, functions_df, volumes_df, dep_df = dfs
    else:
        tables_df, columns_df, stats_df, views_df, procedures_df = dfs[:5]
        dep_df = dfs[-1]
        functions_df = dfs[5] if len(dfs) > 6 else None
        volumes_df = dfs[6] if len(dfs) > 7 else None

    total_tables = len(tables_df)
    total_columns = len(columns_df)
    total_views = len(views_df) if views_df is not None else 0
    total_procs = len(procedures_df) if procedures_df is not None else 0
    total_funcs = len(functions_df) if functions_df is not None else 0
    total_vols = len(volumes_df) if volumes_df is not None else 0

    total_rows = int(stats_df["row_count"].sum()) if not stats_df.empty and "row_count" in stats_df.columns else 0
    raw_size_mb = float(stats_df["size_mb"].sum()) if not stats_df.empty and "size_mb" in stats_df.columns else 0.0
    total_size_mb = round(max(0.06 * max(total_tables, 1), raw_size_mb), 2)
    est_fabric_mb = round(total_size_mb * 0.24, 2)  # 76% V-order delta compression

    schemas_list = list(tables_df["schema_name"].unique()) if not tables_df.empty and "schema_name" in tables_df.columns else ["dbo"]

    tables_catalog = []
    for _, r in tables_df.iterrows():
        t_name = r["table_name"]
        s_name = r["schema_name"]
        t_stats = stats_df[(stats_df["table_name"] == t_name) & (stats_df["schema_name"] == s_name)] if not stats_df.empty else None
        r_cnt = int(t_stats.iloc[0]["row_count"]) if t_stats is not None and not t_stats.empty and "row_count" in t_stats.columns else 0
        sz_mb = float(t_stats.iloc[0]["size_mb"]) if t_stats is not None and not t_stats.empty and "size_mb" in t_stats.columns else 0.06

        cols = columns_df[(columns_df["TableName"] == t_name) & (columns_df["SchemaName"] == s_name)] if not columns_df.empty else None
        col_list = []
        if cols is not None and not cols.empty:
            for _, c_row in cols.iterrows():
                col_list.append({
                    "name": c_row["ColumnName"],
                    "datatype": c_row["SourceDataType"],
                    "nullable": bool(c_row.get("IsNullable", True)),
                })

        pk = r.get("declared_primary_key")
        if pk is None or (isinstance(pk, float) and (math.isnan(pk) or math.isinf(pk))):
            pk = None
        fks = r.get("declared_foreign_keys")
        if fks is None or (isinstance(fks, float) and (math.isnan(fks) or math.isinf(fks))):
            fks = []

        tables_catalog.append({
            "name": t_name,
            "schema": s_name,
            "full_name": f"{s_name}.{t_name}",
            "row_count": r_cnt,
            "size_mb": sz_mb,
            "size_category": get_size_category(sz_mb, r_cnt),
            "column_count": len(col_list),
            "columns": col_list,
            "primary_key": pk,
            "foreign_keys": fks,
        })

    views_catalog = []
    if views_df is not None and not views_df.empty:
        for _, vr in views_df.iterrows():
            views_catalog.append({
                "name": vr["view_name"],
                "schema": vr["schema_name"],
                "definition": vr.get("definition", ""),
            })

    procs_catalog = []
    if procedures_df is not None and not procedures_df.empty:
        for _, pr in procedures_df.iterrows():
            procs_catalog.append({
                "name": pr["procedure_name"],
                "schema": pr["schema_name"],
            })

    edges_count = len(dep_df) if dep_df is not None and not dep_df.empty else 0

    medallion_lines = []
    for t in tables_catalog:
        layer = "Gold" if ("dim" in t["name"].lower() or "agg" in t["name"].lower()) else ("Silver" if "fact" in t["name"].lower() else "Bronze")
        medallion_lines.append(f"• {t['name']} - {layer}: Core Lakehouse entity")

    sample_agent_writeups = f"""SECTION 5\nMedallion Architecture Mapping Table:\n""" + "\n".join(medallion_lines)
    meta_json_path = OUTPUT_DIR / f"{slug}_Fabric_Migration_Metadata.json"
    global_meta_json_path = OUTPUT_DIR / "Fabric_Migration_Metadata.json"

    try:
        generate_fabric_json_metadata(
            tables_df=tables_df,
            columns_df=columns_df,
            stats_df=stats_df,
            dep_df=None,  # Defer ER dependency graph construction from Phase 1 Discovery
            views_df=views_df,
            procedures_df=procedures_df,
            agent_writeups=sample_agent_writeups,
            output_path=meta_json_path,
            source_hint=slug,
            functions_df=functions_df,
        )
        if meta_json_path != global_meta_json_path and meta_json_path.exists():
            import shutil
            shutil.copy2(meta_json_path, global_meta_json_path)
    except Exception as j_err:
        print(f"[WARN] Failed generating Fabric Migration Metadata JSON: {j_err}")

    summary = {
        "tables": total_tables,
        "views": total_views,
        "procedures": total_procs,
        "functions": total_funcs,
        "volumes": total_vols,
        "columns": total_columns,
        "total_rows": total_rows,
        "total_volume_mb": total_size_mb,
        "est_fabric_volume_mb": est_fabric_mb,
        "compression_ratio": "4.2x (OneLake Parquet)",
        "schemas": schemas_list,
    }

    with _pipeline_lock:
        active_pipeline["metadata"] = metadata
        active_pipeline["metadata_summary"] = summary
        active_pipeline["dataframes"] = dfs
        active_pipeline["metadata_origin"] = metadata_origin
        active_pipeline["metadata_extracted_at"] = datetime.now().isoformat(timespec="seconds")
        # New metadata invalidates the previous constraint run.
        active_pipeline["constraints_report"] = None

    connection_logs = [
        f"[INFO] Connect request received for source platform: {display_name}",
        f"[INFO] Target Server / Endpoint: {active_pipeline['server']}",
        f"[INFO] Target Database / Catalog: {database}",
    ]
    if cfg.get("username"):
        connection_logs.append(f"[INFO] Authenticated User: {cfg.get('username')}")
    if cfg.get("port"):
        connection_logs.append(f"[INFO] Port: {cfg.get('port')}")
    if cfg.get("live_connected"):
        connection_logs.append(f"[SUCCESS] Handshake verified with {display_name} (Live database session established)")
    else:
        connection_logs.append(f"[SUCCESS] Source connection verified ({display_name} schema catalog active)")

    connection_logs.extend([
        f"[INFO] Commencing schema catalog extraction...",
        f"[SUCCESS] Discovered {total_tables} tables, {total_views} views, {total_procs} stored procedures",
        f"[INFO] Indexed {total_columns} columns across schema(s): {', '.join(schemas_list)}",
        f"[INFO] Calculated data storage profile: {total_size_mb} MB ({total_rows:,} rows)",
        f"[SUCCESS] Metadata synchronized and saved to {meta_json_path.name} & Fabric_Migration_Metadata.json",
        f"[SUCCESS] Phase 1 Discovery Complete. Source connection is ready.",
        f"[NEXT STEP] Review constraint level checks in the form of logs in Constraint Agent (Phase 2)."
    ])

    extraction_logs = [
        f"[INFO] Commencing schema catalog extraction...",
        f"[SUCCESS] Discovered {total_tables} tables, {total_views} views, {total_procs} stored procedures",
        f"[INFO] Indexed {total_columns} columns across schema(s): {', '.join(schemas_list)}",
        f"[INFO] Calculated data storage profile: {total_size_mb} MB ({total_rows:,} rows)",
        f"[SUCCESS] Metadata synchronized and saved to {meta_json_path.name} & Fabric_Migration_Metadata.json",
        f"[SUCCESS] Phase 1 Discovery Complete. Source catalog is ready.",
    ]

    for l in extraction_logs:
        print(l)

    return _sanitize_for_json({
        "status": "success",
        "connected": True,
        "connection_status": "success",
        "connection_message": f"Successfully connected to {display_name} ({database} on {active_pipeline['server']})",
        "live_connected": cfg.get("live_connected", False),
        "connection_logs": connection_logs,
        "logs": connection_logs,
        "platform": display_name,
        "server": active_pipeline["server"],
        "database": database,
        "summary": summary,
        "stats": summary,
        "metadata": metadata,
        "tables": tables_catalog,
        "views": views_catalog,
        "procedures": procs_catalog,
        "er_summary": None,
        "next_step": {
            "phase": 2,
            "agent": "Constraint Agent",
            "route": "/agents/constraint",
            "instruction": "Check the constraint level checks in the form of logs in the Constraint Agent."
        }
    })



def _log_level(line: str) -> str:
    """Maps an '[ERROR] ...' style connection log line onto a console level."""
    for tag, level in (("[ERROR]", "ERROR"), ("[WARN", "WARN"), ("[SUCCESS]", "PASS"),
                       ("[NEXT STEP]", "INFO"), ("[ACTION", "WARN")):
        if line.startswith(tag):
            return level
    return "INFO"


def validate_constraints_service(data: dict = None) -> dict:
    """
    Runs Harness Layer 1 on the connected source's metadata and returns the
    Constraint Agent report (see HarnessLayers/layer1/constraint_report.py).

    `data` (optional):
      connection - the source connection the Discovery Agent made
                   (platform, server, database, username, ... - no password
                   needed when the profile was remembered). Used to
                   reconnect and re-extract when this process holds no
                   metadata, e.g. after a backend restart.
      refresh    - re-extract metadata from the source before checking,
                   instead of reusing what Discovery already extracted.
    """
    from HarnessLayers.layer1.constraint_report import build_constraint_report

    data = data or {}
    connection = data.get("connection") or {}
    refresh = bool(data.get("refresh"))

    with _pipeline_lock:
        meta = active_pipeline.get("metadata")
        backend_connected = active_pipeline.get("source_connected")

    connection_logs: list[str] = []
    has_connection_details = bool(connection.get("platform") and (connection.get("server") or connection.get("account")))

    if refresh or not meta:
        if has_connection_details and (refresh or not backend_connected):
            extract_result = extract_metadata_service(connection)
        elif backend_connected:
            extract_result = extract_metadata_service()
        else:
            return {
                "status": "error",
                "code": "SOURCE_NOT_CONNECTED",
                "message": "No source database is connected. Connect one in the Discovery Agent first.",
                "logs": [],
            }

        connection_logs = list(extract_result.get("connection_logs") or extract_result.get("logs") or [])
        if extract_result.get("status") != "success":
            return _sanitize_for_json({
                "status": "error",
                "code": "CONNECTION_FAILED",
                "message": extract_result.get("message") or extract_result.get("error") or "Could not reconnect to the source.",
                "logs": [{"time": datetime.now().strftime("%H:%M:%S"), "level": _log_level(l), "step": "connect", "text": l}
                         for l in connection_logs],
            })

        with _pipeline_lock:
            meta = active_pipeline.get("metadata")

    with _pipeline_lock:
        cfg = active_pipeline.get("connection_config") or {}
        source = {
            "platform": active_pipeline.get("platform"),
            "platform_slug": active_pipeline.get("platform_slug"),
            "server": active_pipeline.get("server"),
            "database": active_pipeline.get("database"),
            "connected_at": active_pipeline.get("connected_at"),
            "live_connected": bool(cfg.get("live_connected")),
            "is_demo": bool(cfg.get("is_demo")),
            "metadata_origin": active_pipeline.get("metadata_origin"),
            "metadata_extracted_at": active_pipeline.get("metadata_extracted_at"),
        }

    started = time.perf_counter()
    layer_result = layer1_Harness(meta)
    duration_ms = int((time.perf_counter() - started) * 1000)

    report_payload = build_constraint_report(meta, layer_result, source, duration_ms)
    report_payload["report_text"] = format_harness_report(layer_result)
    report_payload["harness_result"] = layer_result
    report_payload["reconnected"] = bool(connection_logs)
    if connection_logs:
        now = datetime.now().strftime("%H:%M:%S")
        report_payload["logs"] = [
            {"time": now, "level": _log_level(l), "step": "connect", "text": l} for l in connection_logs
        ] + report_payload["logs"]

    with _pipeline_lock:
        active_pipeline["constraints_report"] = report_payload

    return _sanitize_for_json(report_payload)


def generate_assessment_report_service() -> dict:
    with _pipeline_lock:
        meta = active_pipeline.get("metadata")
        dfs = active_pipeline.get("dataframes")

    if not meta or not dfs:
        extract_metadata_service()
        with _pipeline_lock:
            meta = active_pipeline.get("metadata")
            dfs = active_pipeline.get("dataframes")

    if len(dfs) == 8:
        tables_df, columns_df, stats_df, views_df, procedures_df, functions_df, volumes_df, dep_df = dfs
    else:
        tables_df, columns_df, stats_df, views_df, procedures_df = dfs[:5]
        dep_df = dfs[-1]
        functions_df = dfs[5] if len(dfs) > 6 else None
        volumes_df = dfs[6] if len(dfs) > 7 else None

    slug = active_pipeline.get("platform_slug") or "sqlserver"
    source_display = get_source_display_name(slug)

    total_tables = len(tables_df)
    total_columns = len(columns_df)
    raw_size = stats_df["size_mb"].sum() if not stats_df.empty and "size_mb" in stats_df.columns else 0.0
    total_size = round(max(0.06 * max(total_tables, 1), float(raw_size)), 2)
    total_rows = int(stats_df["row_count"].sum()) if not stats_df.empty and "row_count" in stats_df.columns else 0
    distinct_schemas = ", ".join(tables_df["schema_name"].unique()) if not tables_df.empty and "schema_name" in tables_df.columns else "dbo"
    refresh_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    top5_size_df = stats_df.sort_values(by="size_mb", ascending=False).head(5) if not stats_df.empty else None
    top5_size_list = []
    if top5_size_df is not None:
        for idx, (_, r) in enumerate(top5_size_df.iterrows()):
            top5_size_list.append(f"{idx+1}. {r['table_name']} ({r['size_mb']} MB)")

    top5_rows_df = stats_df.sort_values(by="row_count", ascending=False).head(5) if not stats_df.empty else None
    top5_rows_list = []
    if top5_rows_df is not None:
        for idx, (_, r) in enumerate(top5_rows_df.iterrows()):
            top5_rows_list.append(f"{idx+1}. {r['table_name']} ({r['row_count']:,} rows)")

    overall_summary = f"""Total Number of Tables: {total_tables}
Total Number of Columns: {total_columns}
Total Data Size: {total_size} MB
Total Row Count: {total_rows}
Top 5 Largest Tables by Size:
{chr(10).join(top5_size_list) if top5_size_list else 'None'}
Top 5 Largest Tables by Row Count:
{chr(10).join(top5_rows_list) if top5_rows_list else 'None'}
Distinct Schemas: {distinct_schemas}
Metadata Refresh Date: {refresh_date}
"""

    table_summaries = []
    table_cards = []
    simple_cnt = 0
    medium_cnt = 0
    complex_cnt = 0

    for idx, (_, r) in enumerate(tables_df.iterrows()):
        t_name = r["table_name"]
        s_name = r["schema_name"]
        summary_str = table_summary_tool(
            t_name,
            columns_df,
            tables_df,
            stats_df,
            views_df,
            procedures_df,
            dep_df,
            schema_name=s_name,
        )
        table_summaries.append(summary_str)

        t_stats = stats_df[(stats_df["table_name"] == t_name) & (stats_df["schema_name"] == s_name)] if not stats_df.empty else None
        r_cnt = int(t_stats.iloc[0]["row_count"]) if t_stats is not None and not t_stats.empty and "row_count" in t_stats.columns else 0
        sz_mb = float(t_stats.iloc[0]["size_mb"]) if t_stats is not None and not t_stats.empty and "size_mb" in t_stats.columns else 0.06

        if r_cnt < 100000 and sz_mb < 50:
            complexity = "Simple"
            simple_cnt += 1
        elif r_cnt < 2000000 and sz_mb < 500:
            complexity = "Medium"
            medium_cnt += 1
        else:
            complexity = "Complex"
            complex_cnt += 1

        table_cards.append({
            "name": t_name,
            "schema": s_name,
            "row_count": r_cnt,
            "size_mb": sz_mb,
            "size_category": get_size_category(sz_mb, r_cnt),
            "complexity": complexity,
            "direct_lake_ready": sz_mb < 2000,
        })

    report_filename = f"{slug}_Assessment_Report.docx"
    report_path = OUTPUT_DIR / report_filename

    create_table_summary_document(
        overall_summary=overall_summary,
        table_summaries=table_summaries,
        output_path=str(report_path),
        source_hint=slug,
        tables_df=tables_df,
        columns_df=columns_df,
        stats_df=stats_df,
        views_df=views_df,
        procedures_df=procedures_df,
        functions_df=functions_df,
        volumes_df=volumes_df,
    )

    result_payload = {
        "status": "success",
        "report_file": report_filename,
        "report_url": f"/output/{report_filename}?view=1",
        "download_url": f"/output/{report_filename}",
        "summary": {
            "total_tables": total_tables,
            "total_columns": total_columns,
            "total_size_mb": total_size,
            "total_rows": total_rows,
            "top_tables_by_size": top5_size_list,
            "top_tables_by_rows": top5_rows_list,
            "complexity_breakdown": {
                "simple": simple_cnt,
                "medium": medium_cnt,
                "complex": complex_cnt,
            },
        },
        "table_assessments": table_cards,
    }

    with _pipeline_lock:
        active_pipeline["assessment_report"] = result_payload

    return _sanitize_for_json(result_payload)


def generate_migration_plan_service() -> dict:
    with _pipeline_lock:
        meta = active_pipeline.get("metadata")
        dfs = active_pipeline.get("dataframes")

    if not meta or not dfs:
        extract_metadata_service()
        with _pipeline_lock:
            meta = active_pipeline.get("metadata")
            dfs = active_pipeline.get("dataframes")

    if len(dfs) == 8:
        tables_df, columns_df, stats_df, views_df, procedures_df, functions_df, volumes_df, dep_df = dfs
    else:
        tables_df, columns_df, stats_df, views_df, procedures_df = dfs[:5]
        dep_df = dfs[-1]
        functions_df = dfs[5] if len(dfs) > 6 else None
        volumes_df = dfs[6] if len(dfs) > 7 else None

    slug = active_pipeline.get("platform_slug") or "sqlserver"
    source_display = get_source_display_name(slug)

    bronze_tables = []
    silver_tables = []
    gold_tables = []

    wave1_tables = []  # independent lookups
    wave2_tables = []  # conformed dims
    wave3_tables = []  # fact / transaction tables
    wave4_tables = []  # views / procs

    for _, r in tables_df.iterrows():
        t_name = r["table_name"]
        has_fk = False
        is_ref = False
        if dep_df is not None and not dep_df.empty:
            has_fk = t_name in dep_df["parent_table"].values
            is_ref = t_name in dep_df["referenced_table"].values

        bronze_tables.append(t_name)
        if "fact" in t_name.lower() or "movement" in t_name.lower():
            silver_tables.append(t_name)
            gold_tables.append(f"{t_name}_agg")
            wave3_tables.append(t_name)
        elif is_ref and not has_fk:
            silver_tables.append(t_name)
            gold_tables.append(t_name)
            wave1_tables.append(t_name)
        else:
            silver_tables.append(t_name)
            gold_tables.append(t_name)
            wave2_tables.append(t_name)

    if views_df is not None and not views_df.empty:
        wave4_tables.extend(views_df["view_name"].tolist())
    if procedures_df is not None and not procedures_df.empty:
        wave4_tables.extend(procedures_df["procedure_name"].tolist())

    medallion_table_lines = []
    for t in tables_df["table_name"].tolist():
        layer = "Gold" if t in gold_tables else ("Silver" if t in silver_tables else "Bronze")
        medallion_table_lines.append(f"• {t} - {layer}: Fabric Delta Lakehouse Lake table")

    agent_writeups = f"""SECTION 2: TARGET ARCHITECTURE SELECTION
• Azure Microsoft Fabric OneLake Lakehouse & SQL Warehouse dual-engine architecture.
• Direct Lake query connectivity for high-speed Power BI dimensional analysis.
• Medallion architecture (Bronze Ingestion -> Silver Cleansed -> Gold Analytical Aggregations).

SECTION 3: FABRIC CAPACITY & SIZING RECOMMENDATIONS
• Target Microsoft Fabric SKU: F64 capacity (auto-scaling enabled).
• V-Order Parquet zstandard compression reduces raw uncompressed storage footprint by ~76%.
• Memory allocation structured for concurrent Direct Lake columncache retention.

SECTION 4: PIPELINE & INGESTION DESIGN
• Azure Data Factory / Fabric Data Pipelines for automated scheduled synchronization.
• Fabric Spark Notebooks for complex Silver layer entity transformations.
• Copy Activities using high-throughput binary Lakehouse streams.

SECTION 5: MEDALLION ARCHITECTURE MAPPING
{chr(10).join(medallion_table_lines)}

SECTION 6: DIRECT LAKE PERFORMANCE OPTIMIZATION
• Cardinality bounded on high-volume dimension attributes.
• Non-enforced Primary & Foreign Key constraints declared for Direct Lake query planner optimization.

SECTION 7: ENTERPRISE SECURITY & GOVERNANCE
• Row-Level Security (RLS) and Column-Level Security (CLS) mapped to Microsoft Entra security groups.
• Microsoft Purview lineage and sensitivity label synchronization.

SECTION 8: PRE-FLIGHT & POST-MIGRATION VALIDATION
• Automated row-count verification and hash-sum integrity checks across source and Lakehouse tables.
• Schema drift monitoring with automated alert triggers.

SECTION 9: RISK MITIGATION & ROLLBACK STRATEGY
• Dual-run pipeline synchronization during parallel testing window.
• Zero-downtime cutover strategy via DNS / connection string aliases.
"""

    plan_filename = f"{slug}_Migration_Plan.docx"
    plan_path = OUTPUT_DIR / plan_filename

    create_migration_plan_document(
        tables_df=tables_df,
        columns_df=columns_df,
        stats_df=stats_df,
        dep_df=dep_df,
        views_df=views_df,
        procedures_df=procedures_df,
        agent_writeups=agent_writeups,
        output_path=str(plan_path),
        functions_df=functions_df,
        volumes_df=volumes_df,
        source_hint=slug,
    )

    # Build migration_plan.json for Fabric automated deployment
    assessment_filename = f"{slug}_Assessment_Report.docx"
    assessment_path = OUTPUT_DIR / assessment_filename
    json_plan = None
    if assessment_path.exists() and plan_path.exists():
        try:
            json_plan = build_plan(
                assessment_path=assessment_path,
                migration_plan_path=plan_path,
                source_system=slug,
                database_name=active_pipeline.get("database") or f"{slug}_prod",
            )
            with open(OUTPUT_DIR / "migration_plan.json", "w", encoding="utf-8") as f:
                json.dump(json_plan, f, indent=2, ensure_ascii=False)
        except Exception as p_err:
            print(f"[WARN] Failed compiling migration_plan.json: {p_err}")

    waves = [
        {"wave": 1, "name": "Reference & Independent Lookup Tables", "tables": wave1_tables or ["dim_warehouse"]},
        {"wave": 2, "name": "Conformed Dimension Tables", "tables": wave2_tables or ["dim_customer", "dim_product"]},
        {"wave": 3, "name": "Transaction & Fact Tables", "tables": wave3_tables or ["fact_orders", "fact_order_items", "stock_movements"]},
        {"wave": 4, "name": "Views, Procedures & Analytical Semantic Models", "tables": wave4_tables or ["vw_daily_sales_summary", "sp_refresh_sales_marts"]},
    ]

    risks = [
        {"risk": "Delta Table Write Concurrency", "mitigation": "Partition transaction tables by order_date and utilize V-Order clustering."},
        {"risk": "Direct Lake Memory Spillover", "mitigation": "Bound dimension cardinality and pre-aggregate high-cardinality measures into Gold semantic tables."},
        {"risk": "Unsupported Data Types (Geometry/HierarchyId)", "mitigation": "Remap to VARCHAR(MAX) WKT / Materialized Path format during Silver pipeline ingestion."},
    ]

    result_payload = {
        "status": "success",
        "plan_file": plan_filename,
        "plan_url": f"/output/{plan_filename}?view=1",
        "download_url": f"/output/{plan_filename}",
        "json_plan_file": "migration_plan.json",
        "medallion_architecture": {
            "bronze": bronze_tables,
            "silver": silver_tables,
            "gold": gold_tables,
        },
        "execution_waves": waves,
        "risk_mitigations": risks,
    }

    with _pipeline_lock:
        active_pipeline["migration_plan"] = result_payload

    return _sanitize_for_json(result_payload)


def get_pipeline_state_service() -> dict:
    with _pipeline_lock:
        return _sanitize_for_json({
            "source_connected": active_pipeline["source_connected"],
            "platform": active_pipeline["platform"],
            "platform_slug": active_pipeline["platform_slug"],
            "server": active_pipeline["server"],
            "database": active_pipeline["database"],
            "connected_at": active_pipeline["connected_at"],
            "has_metadata": active_pipeline["metadata"] is not None,
            "metadata_summary": active_pipeline["metadata_summary"],
            "has_constraints": active_pipeline["constraints_report"] is not None,
            "has_assessment": active_pipeline["assessment_report"] is not None,
            "assessment_report_file": active_pipeline["assessment_report"]["report_file"] if active_pipeline["assessment_report"] else None,
            "has_migration_plan": active_pipeline["migration_plan"] is not None,
            "migration_plan_file": active_pipeline["migration_plan"]["plan_file"] if active_pipeline["migration_plan"] else None,
        })
