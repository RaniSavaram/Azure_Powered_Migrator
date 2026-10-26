import pymssql
import json
from pathlib import Path

from Metadata_Scanner.extractors.base_extractor import BaseExtractor
from Metadata_Scanner.extractors.declared_keys import read_sqlserver_keys
from config.Credentials import PrivateVariables

class SQLServerExtractor(BaseExtractor):

    def __init__(self,Creds):
        self.server = Creds.get_servername()
        self.database = Creds.get_database_name()
        self.username = Creds.get_username()
        self.password = Creds.get_password()
        self.connection = None


    def connect(self):

        print("Server   :", repr(self.server))
        print("Database :", repr(self.database))
        print("User     :", repr(self.username))

        if not self.server:
            raise ValueError("Server name is empty.")

        if not self.database:
            raise ValueError("Database name is empty.")

        if not self.username:
            raise ValueError("Username is empty.")

        if self.password is None:
            raise ValueError("Password is None.")

        self.connection = pymssql.connect(
            server=self.server,
            database=self.database,
            user=self.username,
            password=self.password,
            timeout=600,
            as_dict=True
        )

    def close(self):

        if self.connection:
            try:
                self.connection.close()
            except Exception:
                pass
            self.connection = None

    def extract(self, output_file="data/metadata.json"):

        if not self.connection:
            self.connect()

        metadata = {
            "database": self.database,
            "schemas": []
        }

        cursor = self.connection.cursor()

        cursor.execute("""
            SELECT
                TABLE_SCHEMA,
                TABLE_NAME,
                TABLE_TYPE
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY TABLE_SCHEMA,
                     TABLE_NAME
        """)

        tables = cursor.fetchall()
        # Normalize dict access if using pyodbc or pymssql
        def _get_val(r, key, idx=0):
            if isinstance(r, dict):
                return r.get(key)
            return r[idx]

        schema_map = {}

        # 1. Fetch all columns in ONE single batch query
        cols_by_table = {}
        try:
            col_cur = self.connection.cursor()
            col_cur.execute("""
                SELECT
                    TABLE_SCHEMA,
                    TABLE_NAME,
                    COLUMN_NAME,
                    DATA_TYPE,
                    CHARACTER_MAXIMUM_LENGTH,
                    NUMERIC_PRECISION,
                    NUMERIC_SCALE,
                    IS_NULLABLE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY ORDINAL_POSITION
            """)
            for crow in col_cur.fetchall():
                s_name = _get_val(crow, "TABLE_SCHEMA", 0)
                t_name = _get_val(crow, "TABLE_NAME", 1)
                k = (s_name, t_name)
                if k not in cols_by_table:
                    cols_by_table[k] = []
                cols_by_table[k].append({
                    "name": _get_val(crow, "COLUMN_NAME", 2),
                    "datatype": _get_val(crow, "DATA_TYPE", 3),
                    "max_length": _get_val(crow, "CHARACTER_MAXIMUM_LENGTH", 4),
                    "precision": _get_val(crow, "NUMERIC_PRECISION", 5),
                    "scale": _get_val(crow, "NUMERIC_SCALE", 6),
                    "nullable": _get_val(crow, "IS_NULLABLE", 7),
                })
        except Exception as col_err:
            print(f"[WARNING] Batch column query notice: {col_err}")

        # 2. Fetch row count and size in MB for all tables in ONE single batch query
        stats_by_table = {}
        try:
            size_cursor = self.connection.cursor()
            size_cursor.execute("""
                SELECT 
                    s.name AS schema_name,
                    t.name AS table_name,
                    SUM(p.rows) AS row_count,
                    ROUND(SUM(a.total_pages) * 8 / 1024.0, 2) AS size_mb
                FROM sys.tables t
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                JOIN sys.indexes i ON t.object_id = i.object_id
                JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
                JOIN sys.allocation_units a ON p.partition_id = a.container_id
                GROUP BY s.name, t.name
            """)
            for srow in size_cursor.fetchall():
                sn = _get_val(srow, "schema_name", 0)
                tn = _get_val(srow, "table_name", 1)
                rc = int(_get_val(srow, "row_count", 2) or 0)
                sz = float(_get_val(srow, "size_mb", 3) or 0.06)
                stats_by_table[(sn, tn)] = {"row_count": rc, "size_mb": sz}
        except Exception as st_err:
            print(f"[WARNING] Batch sizing query notice: {st_err}")

        for table in tables:
            schema_name = _get_val(table, "TABLE_SCHEMA", 0)
            table_name = _get_val(table, "TABLE_NAME", 1)
            table_type = _get_val(table, "TABLE_TYPE", 2)

            if schema_name not in schema_map:
                schema_map[schema_name] = {
                    "name": schema_name,
                    "tables": [],
                    "procedures": []
                }

            t_cols = cols_by_table.get((schema_name, table_name), [])
            t_stats = stats_by_table.get((schema_name, table_name), {})
            r_cnt = t_stats.get("row_count", 0)
            sz_mb = t_stats.get("size_mb", 0.06)

            table_object = {
                "name": table_name,
                "type": table_type,
                "columns": t_cols,
                "row_count": r_cnt,
                "size_mb": sz_mb
            }
            schema_map[schema_name]["tables"].append(table_object)

        # Stored procedures, kept per-schema alongside "tables" so Harness
        # Layer 1's PROCEDURES_DETECTED check (HarnessLayers/layer1/Layer.py)
        # has something to see on a real scan.
        try:
            proc_cursor = self.connection.cursor()
            proc_cursor.execute("""
                SELECT
                    ROUTINE_SCHEMA,
                    ROUTINE_NAME
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_TYPE = 'PROCEDURE'
                  AND ROUTINE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
            """)
            for proc in proc_cursor.fetchall():
                schema_name = proc["ROUTINE_SCHEMA"]
                if schema_name not in schema_map:
                    schema_map[schema_name] = {"name": schema_name, "tables": [], "procedures": []}
                schema_map[schema_name]["procedures"].append({"name": proc["ROUTINE_NAME"]})
        except Exception as e:
            print(f"[WARNING] Could not list stored procedures: {e}")

        # Declared primary/foreign keys (see declared_keys.py) - the ER
        # diagram draws these instead of guessing from column names.
        try:
            pk_tables, fk_count = read_sqlserver_keys(self.connection, schema_map)
            print(f"[INFO] Declared keys: {pk_tables} table(s) with a primary key, {fk_count} foreign key(s).")
        except Exception as e:
            print(f"[WARNING] Could not read declared keys: {e}")

        metadata["schemas"] = list(schema_map.values())

        Path(output_file).parent.mkdir(
            parents=True,
            exist_ok=True
        )

        with open(output_file, "w", encoding="utf-8") as fp:

            json.dump(
                metadata,
                fp,
                indent=4
            )

        self.close()

        return metadata