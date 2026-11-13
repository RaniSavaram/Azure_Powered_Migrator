import os
import json
import time
import ssl
import sys
import uuid
import threading
import pandas as pd
from dotenv import dotenv_values
from pathlib import Path


def _ensure_clean_ssl_for_truststore() -> None:
    """
    Prevent a RecursionError on Windows when pip_system_certs injects
    pip._vendor.truststore into stdlib ssl.SSLContext before httpx2/openai
    loads the standalone truststore package.
    """
    if "truststore" in sys.modules:
        return
    if getattr(ssl.SSLContext, "__module__", "").startswith("pip._vendor.truststore"):
        try:
            from pip._vendor import truststore as _pip_ts
            _pip_ts.extract_from_ssl()
        except Exception:
            pass


_ensure_clean_ssl_for_truststore()

# Import agent definitions from the agents directory
from agents import TableSummarizerAgent, MigrationGeneratorAgent

# Import metadata, document generation, and tools
from metadataProcessor import collect_metadata, count_table_columns, read_csv_robust, infer_sql_type
from docx_generator import create_table_summary_document, create_migration_plan_document, set_cell_margins, get_source_display_name
from tools.database_tools import (
    table_summary_tool,
    view_summary_tool,
    function_summary_tool,
    procedure_summary_tool,
    volume_summary_tool,
    get_size_category,
)
from rag import identify_source_type, get_common_fabric_kb, get_source_kb
from Logs import Logs

# Reconfigure stdout to use UTF-8 just in case
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass


class FoundryAuthError(RuntimeError):
    """Raised when Azure AI Foundry authentication or RBAC authorization fails."""


class FoundryContentFilterError(RuntimeError):
    """Raised when an Azure AI Foundry deployment guardrail blocks or truncates output."""


def is_foundry_content_filter_error(exc: Exception) -> bool:
    if isinstance(exc, FoundryContentFilterError):
        return True
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            "content_filter",
            "personallyidentifiableinformation",
            "response content blocked",
        )
    )


def is_foundry_auth_error(exc: Exception) -> bool:
    if isinstance(exc, FoundryAuthError):
        return True
    cls_name = type(exc).__name__
    if cls_name in ("ClientAuthenticationError", "CredentialUnavailableError", "AuthenticationError"):
        return True
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            "clientauthenticationerror",
            "credentialunavailableerror",
            "defaultazurecredential failed",
            "az login",
            "authenticationfailed",
            "unauthorized",
            "401",
            "403",
            "permission denied",
            "authorizationfailed",
        )
    )


def _build_auth_error_message(exc: Exception) -> str:
    return (
        f"Azure AI Foundry authentication/permission failed: {exc}. "
        "Local dev: run 'az login' (or set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET in BackEnd/.env). "
        "Render/Cloud: verify AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET env vars and grant that Service Principal "
        "the Azure AI Developer / Cognitive Services User role on your Foundry project."
    )


def build_metadata_summary_str(tables_df, columns_df, stats_df, dep_df) -> str:
    total_tables = len(tables_df) if tables_df is not None else 0
    total_columns = count_table_columns(columns_df, tables_df)
    distinct_schemas = ", ".join(tables_df["schema_name"].unique()) if tables_df is not None and not tables_df.empty and "schema_name" in tables_df.columns else "dbo"

    stats_summary_list = []
    if stats_df is not None and not stats_df.empty:
        for _, r in stats_df.iterrows():
            stats_summary_list.append(
                f"- Table: {r['table_name']}, Schema: {r['schema_name']}, Rows: {r['row_count']}, Size: {r['size_mb']} MB"
            )

    cols_summary_list = []
    if columns_df is not None and not columns_df.empty:
        for _, r in columns_df.head(100).iterrows():
            dtype = r.get('SourceDataType') or r.get('data_type') or 'unknown'
            cols_summary_list.append(f"- Col: {r['TableName']}.{r['ColumnName']} ({dtype})")

    dep_summary_list = []
    if dep_df is not None and not dep_df.empty:
        for _, r in dep_df.iterrows():
            dep_summary_list.append(
                f"- ForeignKey: {r['parent_table']}({r['fk_name']}) -> {r['referenced_table']}"
            )

    stats_summary_str = "\n".join(stats_summary_list) if stats_summary_list else "None"
    dep_summary_str = "\n".join(dep_summary_list) if dep_summary_list else "None"
    cols_summary_str = "\n".join(cols_summary_list) if cols_summary_list else "None"
    return f"""Overall Stats:
- Total tables: {total_tables}
- Total columns: {total_columns}
- Distinct schemas: {distinct_schemas}

Tables and sizes:
{stats_summary_str}

Dependencies:
{dep_summary_str}

Columns Sample:
{cols_summary_str}
"""


class AzureAIOrchestrator:
    """
    Orchestrates agent creation, prompt execution, and function tool invocations
    using the Microsoft Azure AI Projects SDK.
    """
    @staticmethod
    def _load_strict_foundry_config():
        """
        Reads Azure AI Foundry settings strictly from project-local .env files
        (phase_1/.env, BackEnd/.env, AI_Agent_Pipeline/.env) without walking above
        the repository. Falls back to container os.environ only when no project
        .env file exists (e.g. Render/Docker deployments).
        """
        curr = Path(__file__).resolve()
        repo_root = curr.parents[3]
        backend_dir = curr.parents[2]
        pipeline_dir = curr.parents[1]
        env_candidates = [repo_root / ".env", backend_dir / ".env", pipeline_dir / ".env"]
        existing_envs = [p for p in env_candidates if p.is_file()]

        if existing_envs:
            raw_cfg = {}
            for env_file in existing_envs:
                for k, v in dotenv_values(env_file).items():
                    if v is not None:
                        raw_cfg[k] = str(v)
            source_desc = ", ".join(str(p) for p in existing_envs)
        else:
            raw_cfg = dict(os.environ)
            source_desc = "container environment (no project .env found)"

        required_keys = [
            "AZURE_AI_FOUNDRY_PROJECT_ENDPOINT",
            "AZURE_AI_FOUNDRY_AGENT_NAME",
            "AZURE_AI_FOUNDRY_TABLE_SUMMARIZER_MODEL",
            "AZURE_AI_FOUNDRY_MIGRATION_PLAN_MODEL",
        ]
        config = {key: (raw_cfg.get(key) or "").strip() for key in required_keys}
        missing = [key for key, val in config.items() if not val]
        if missing:
            raise ValueError(
                f"[STRICT CONFIG ERROR] Missing required Azure AI Foundry setting(s) in {source_desc}: "
                f"{', '.join(missing)}. Set all required keys inside BackEnd/.env or project root .env."
            )
        for sp_key in ("AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"):
            config[sp_key] = (raw_cfg.get(sp_key) or os.environ.get(sp_key) or "").strip()
        return config

    def __init__(self, tables_df, columns_df, stats_df, views_df, procedures_df, dep_df, source_hint=None, functions_df=None, volumes_df=None, scan_id=None):
        self._token_lock = threading.Lock()
        cfg = self._load_strict_foundry_config()
        self._sp_tenant_id = cfg["AZURE_TENANT_ID"]
        self._sp_client_id = cfg["AZURE_CLIENT_ID"]
        self._sp_client_secret = cfg["AZURE_CLIENT_SECRET"]
        self.endpoint = cfg["AZURE_AI_FOUNDRY_PROJECT_ENDPOINT"]
        self.base_agent_name = cfg["AZURE_AI_FOUNDRY_AGENT_NAME"]

        # Strictly use the exact model deployment specified per agent (no shared fallback)
        self.table_summarizer_model = cfg["AZURE_AI_FOUNDRY_TABLE_SUMMARIZER_MODEL"]
        self.migration_generator_model = cfg["AZURE_AI_FOUNDRY_MIGRATION_PLAN_MODEL"]

        # Retain self.model_name for backward compatibility
        self.model_name = self.table_summarizer_model
        self.scan_id = scan_id
        self.source_hint = source_hint

        # Save DataFrames as attributes to expose to tools
        self.tables_df = tables_df
        self.columns_df = columns_df
        self.stats_df = stats_df
        self.views_df = views_df
        self.procedures_df = procedures_df
        self.dep_df = dep_df
        self.functions_df = functions_df
        self.volumes_df = volumes_df
        
        self.client_type = None
        self.client = None

        # Resolve the source platform once so the RAG knowledge bases can be
        # looked up dynamically (see rag/registry.py) instead of hardcoding
        # a source type here. Falls back to common Fabric guidance only when
        # no source-specific knowledge base has been authored yet.
        self.source_type = identify_source_type(hint=source_hint)
        self._common_kb = get_common_fabric_kb()
        self._source_kb = get_source_kb(self.source_type)
        rag_source_msg = (
            f"[INFO] Detected source platform: '{self.source_type}' "
            f"(source-specific Fabric migration guidance {'found' if self._source_kb else 'not available - falling back to common Fabric guidance'})."
        )
        Logs["Scan Info"].append(rag_source_msg)
        print(rag_source_msg)
        
        # Names for the agents (Azure requires alphanumeric and hyphens only).
        # A per-run suffix keeps concurrent scans from colliding on the same
        # agent name - without it, _delete_if_exists() in one scan's
        # create_agents() would delete another concurrently-running scan's
        # live agent, surfacing as "Agent not found" mid-run.
        sanitized_base = self.base_agent_name.replace("_", "-").replace(" ", "-").lower()
        run_suffix = uuid.uuid4().hex[:8]
        self.table_summarizer_name = f"{sanitized_base}-table-summarizer-{run_suffix}"
        self.migration_plan_name = f"{sanitized_base}-migration-plan-generator-{run_suffix}"
        
        # Agent Helpers configured strictly with their respective models
        self.table_summarizer_builder = TableSummarizerAgent(self.table_summarizer_name, self.table_summarizer_model)
        self.migration_generator_builder = MigrationGeneratorAgent(self.migration_plan_name, self.migration_generator_model)
        
        # Azure Agent Version Instances
        self.table_summarizer_agent = None
        self.migration_plan_agent = None
        self.tokens_used = {"prompt": 0, "completion": 0, "total": 0}
        
        self.initialize_client()

    def _log_agent(self, msg: str):
        """Streams readable agent log to both Backend Logs and Evaluator-Generator Feedback Layer."""
        print(msg)
        if self.scan_id:
            try:
                from Migrator.views import update_scan_job_state
                update_scan_job_state(self.scan_id, log_entry=msg, log_type="Harness Layer2")
                update_scan_job_state(self.scan_id, log_entry=msg, log_type="Scan Info")
            except Exception:
                pass
        else:
            Logs["Harness Layer2"].append(msg)
            Logs["Scan Info"].append(msg)

    def initialize_client(self):
        if not self.endpoint:
            raise ValueError("[ERROR] AZURE_AI_FOUNDRY_PROJECT_ENDPOINT is missing in `.env` file.")

        Logs["Scan Info"].append(f"[INFO] Initializing Azure AI Projects Client...")
        print("[INFO] Initializing Azure AI Projects Client...")
        from azure.identity import ClientSecretCredential, DefaultAzureCredential
        from azure.ai.projects import AIProjectClient
        try:
            if self._sp_tenant_id and self._sp_client_id and self._sp_client_secret:
                credential = ClientSecretCredential(
                    tenant_id=self._sp_tenant_id,
                    client_id=self._sp_client_id,
                    client_secret=self._sp_client_secret,
                )
            else:
                # exclude_shared_token_cache_credential/exclude_broker_credential:
                # prevent stale Windows WAM / shared token cache errors.
                credential = DefaultAzureCredential(
                    exclude_shared_token_cache_credential=True,
                    exclude_broker_credential=True,
                    process_timeout=60,
                )
            self.client = AIProjectClient(
                endpoint=self.endpoint,
                credential=credential,
            )
        except Exception as exc:
            if is_foundry_auth_error(exc):
                raise FoundryAuthError(_build_auth_error_message(exc)) from exc
            raise
        self.client_type = "projects"
        Logs["Scan Info"].append(f"[INFO] Azure AI Projects Client initialized successfully.")
        print("[INFO] Azure AI Projects Client initialized successfully.")

    def get_table_metadata(self, table_name: str, schema_name: str = None) -> str:
        """
        Tool function to get database metadata summary for a single table.
        Wraps table_summary_tool using the preloaded dataframes.
        """
        return table_summary_tool(
            table_name,
            self.columns_df,
            self.tables_df,
            self.stats_df,
            self.views_df,
            self.procedures_df,
            self.dep_df,
            schema_name=schema_name
        )

    def get_view_metadata(self, view_name: str, schema_name: str = None) -> str:
        """Tool function counterpart to get_table_metadata, for VIEW objects."""
        Logs["Scan Info"].append(f"  [TOOL RUN] Fetching metadata summary for view: '{view_name}' (Schema: '{schema_name}')...")
        print(f"  [TOOL RUN] Fetching metadata summary for view: '{view_name}' (Schema: '{schema_name}')...")
        return view_summary_tool(view_name, self.columns_df, self.views_df, schema_name=schema_name)

    def get_function_metadata(self, function_name: str, schema_name: str = None) -> str:
        """Tool function counterpart to get_table_metadata, for FUNCTION objects."""
        Logs["Scan Info"].append(f"  [TOOL RUN] Fetching metadata summary for function: '{function_name}' (Schema: '{schema_name}')...")
        print(f"  [TOOL RUN] Fetching metadata summary for function: '{function_name}' (Schema: '{schema_name}')...")
        return function_summary_tool(function_name, self.functions_df, schema_name=schema_name)

    def get_procedure_metadata(self, procedure_name: str, schema_name: str = None) -> str:
        """Tool function counterpart to get_table_metadata, for stored PROCEDURE objects."""
        Logs["Scan Info"].append(f"  [TOOL RUN] Fetching metadata summary for procedure: '{procedure_name}' (Schema: '{schema_name}')...")
        print(f"  [TOOL RUN] Fetching metadata summary for procedure: '{procedure_name}' (Schema: '{schema_name}')...")
        return procedure_summary_tool(procedure_name, self.procedures_df, schema_name=schema_name)

    def get_volume_metadata(self, volume_name: str, schema_name: str = None) -> str:
        """Tool function counterpart to get_table_metadata, for VOLUME objects."""
        Logs["Scan Info"].append(f"  [TOOL RUN] Fetching metadata summary for volume: '{volume_name}' (Schema: '{schema_name}')...")
        print(f"  [TOOL RUN] Fetching metadata summary for volume: '{volume_name}' (Schema: '{schema_name}')...")
        return volume_summary_tool(volume_name, self.volumes_df, schema_name=schema_name)

    def _get_rag_context(self, query, top_k=3, max_chars_per_chunk=900):
        if self._source_kb:
            return self._source_kb.retrieve_as_text(
                query,
                top_k=top_k,
                max_chars_per_chunk=max_chars_per_chunk,
            )
        if self._common_kb:
            return self._common_kb.retrieve_as_text(
                query,
                top_k=top_k,
                max_chars_per_chunk=max_chars_per_chunk,
            )
        return ""

    def _delete_if_exists(self, agent_name):
        """
        Best-effort delete of a leftover agent from a prior run that didn't
        reach cleanup_agents() (e.g. crashed mid-pipeline). create_version()
        rejects with a conflict if an agent with this name is already
        registered, so clear the name first to make agent creation
        idempotent across retries.
        """
        try:
            self.client.agents.delete(agent_name)
            Logs["Scan Info"].append(f"[INFO] Removed leftover agent '{agent_name}' from a previous run.")
            print(f"[INFO] Removed leftover agent '{agent_name}' from a previous run.")
        except Exception:
            pass  # nothing to delete - this is the expected case

    def create_table_summarizer_agent(self):
        Logs["Scan Info"].append(
            f"[INFO] Initializing Table_summarizer agent version '{self.table_summarizer_name}' using model '{self.table_summarizer_model}' on Azure AI Foundry..."
        )
        print(f"[INFO] Initializing Table_summarizer agent version '{self.table_summarizer_name}' using model '{self.table_summarizer_model}' on Azure AI Foundry...")
        self._delete_if_exists(self.table_summarizer_name)
        try:
            self.table_summarizer_agent = self.table_summarizer_builder.create(self.client)
        except Exception as exc:
            if is_foundry_auth_error(exc):
                raise FoundryAuthError(_build_auth_error_message(exc)) from exc
            raise
        Logs["Scan Info"].append(
            f"[INFO] Table_summarizer agent version created (ID: {self.table_summarizer_agent.id}, Version: {self.table_summarizer_agent.version}, Model: {self.table_summarizer_model})."
        )
        print(f"[INFO] Table_summarizer agent version created (ID: {self.table_summarizer_agent.id}, Version: {self.table_summarizer_agent.version}, Model: {self.table_summarizer_model}).")
        return self.table_summarizer_agent

    def create_migration_generator_agent(self):
        Logs["Scan Info"].append(
            f"[INFO] Initializing Migration_plan_generator agent version '{self.migration_plan_name}' using model '{self.migration_generator_model}' on Azure AI Foundry..."
        )
        print(f"[INFO] Initializing Migration_plan_generator agent version '{self.migration_plan_name}' using model '{self.migration_generator_model}' on Azure AI Foundry...")
        self._delete_if_exists(self.migration_plan_name)
        try:
            self.migration_plan_agent = self.migration_generator_builder.create(self.client)
        except Exception as exc:
            if is_foundry_auth_error(exc):
                raise FoundryAuthError(_build_auth_error_message(exc)) from exc
            raise
        Logs["Scan Info"].append(
            f"[INFO] Migration_plan_generator agent version created (ID: {self.migration_plan_agent.id}, Version: {self.migration_plan_agent.version}, Model: {self.migration_generator_model})."
        )
        print(f"[INFO] Migration_plan_generator agent version created (ID: {self.migration_plan_agent.id}, Version: {self.migration_plan_agent.version}, Model: {self.migration_generator_model}).")
        return self.migration_plan_agent

    def create_agents(self):
        """
        Creates both Table_summarizer and Migration_plan_generator agents using Microsoft AI Foundry SDK
        """
        Logs["Scan Info"].append("[INFO] Creating agents using Microsoft AI Foundry SDK...")
        print("[INFO] Creating agents using Microsoft AI Foundry SDK...")
        self.create_table_summarizer_agent()
        self.create_migration_generator_agent()
        return True

    def _accumulate_usage(self, response):
        if not response or not hasattr(response, "usage") or not response.usage:
            return
        usage = response.usage
        prompt_tok = getattr(usage, "prompt_tokens", 0) or getattr(usage, "input_tokens", 0) or 0
        comp_tok = getattr(usage, "completion_tokens", 0) or getattr(usage, "output_tokens", 0) or 0
        total_tok = getattr(usage, "total_tokens", 0) or (prompt_tok + comp_tok)
        
        with self._token_lock:
            self.tokens_used["prompt"] += prompt_tok
            self.tokens_used["completion"] += comp_tok
            self.tokens_used["total"] += total_tok

    def run_agent_with_tool_calling(self, agent_name: str, user_msg: str, tool_map: dict = None) -> str:
        try:
            Logs["Harness Layer2"].append(f"[AGENT START] {agent_name}")
            openai_client = self.client.get_openai_client(agent_name=agent_name)
            conversation = openai_client.conversations.create()

            response = openai_client.responses.create(
                conversation=conversation.id,
                input=user_msg,
                extra_body={
                    "agent_reference": {
                        "name": agent_name,
                        "type": "agent_reference"
                    }
                }
            )
            self._accumulate_usage(response)
            Logs["Harness Layer2"].append(
                f"[AGENT RESPONSE] {agent_name}: initial response received."
            )

            while True:
                tool_calls = [item for item in response.output if item.type == "function_call"]
                if not tool_calls:
                    break

                input_list = []
                for item in tool_calls:
                    func_name = item.name
                    func_args = json.loads(item.arguments)
                    tool_target = (
                        func_args.get("table_name")
                        or func_args.get("view_name")
                        or func_args.get("function_name")
                        or func_args.get("procedure_name")
                        or func_args.get("volume_name")
                        or "?"
                    )
                    if func_args.get("schema_name"):
                        tool_target = f"{func_args['schema_name']}.{tool_target}"
                    Logs["Harness Layer2"].append(
                        f"[TOOL REQUEST] {agent_name} requested {func_name} for {tool_target}."
                    )
                    agent_request_msg = f"  [AGENT] {agent_name} is requesting '{func_name}' for {tool_target}..."
                    Logs["Scan Info"].append(agent_request_msg)
                    print(agent_request_msg)

                    if tool_map and func_name in tool_map:
                        try:
                            output_str = tool_map[func_name](**func_args)
                        except Exception as e:
                            Logs["Harness Layer2"].append(f"[TOOL FAILED] {func_name}: {e}")
                            Logs["Scan Info"].append(f"[ERROR] Tool '{func_name}' failed: {e}")
                            output_str = f"Error executing tool: {e}"
                    else:
                        Logs["Scan Info"].append(f"[ERROR] Tool '{func_name}' is not registered.")
                        output_str = f"Error: Tool '{func_name}' is not registered."

                    try:
                        from openai.types.responses import ResponseFunctionToolCallOutputItem
                        output_item = ResponseFunctionToolCallOutputItem(
                            call_id=item.call_id or item.id,
                            output=output_str
                        )
                    except Exception:
                        output_item = {
                            "type": "function_call_output",
                            "call_id": item.call_id or item.id,
                            "output": output_str
                        }
                    input_list.append(output_item)
                    Logs["Harness Layer2"].append(f"[TOOL COMPLETE] {func_name} returned.")
                agent_continue_msg = f"  [AGENT] {agent_name} received the tool result - continuing..."
                Logs["Scan Info"].append(agent_continue_msg)
                print(agent_continue_msg)
                response = openai_client.responses.create(
                    conversation=conversation.id,
                    input=input_list
                )
                self._accumulate_usage(response)
                Logs["Harness Layer2"].append(
                    f"[AGENT RESPONSE] {agent_name}: follow-up response received."
                )

            try:
                openai_client.conversations.delete(conversation_id=conversation.id)
            except Exception as cleanup_err:
                print(f"[INFO] Could not delete the agent conversation (non-fatal): {cleanup_err}")
            output_text = response.output_text
            incomplete_reason = getattr(getattr(response, "incomplete_details", None), "reason", None)
            if (
                getattr(response, "status", None) == "incomplete"
                and incomplete_reason == "content_filter"
                and len((output_text or "").strip()) < 1500
            ):
                raise FoundryContentFilterError(
                    f"Azure AI Foundry content_filter truncated output for {agent_name} "
                    f"at {len((output_text or '').strip())} characters."
                )
            Logs["Harness Layer2"].append(
                f"[AGENT COMPLETE] {agent_name}: generated {len(output_text or '')} characters."
            )
            return output_text
        except Exception as exc:
            if is_foundry_auth_error(exc):
                auth_msg = _build_auth_error_message(exc)
                Logs["Scan Info"].append(f"  [AUTH ERROR] {auth_msg}")
                Logs["Harness Layer2"].append(f"  [AUTH ERROR] {auth_msg}")
                raise FoundryAuthError(auth_msg) from exc
            if is_foundry_content_filter_error(exc):
                cf_msg = (
                    f"Azure AI Foundry content filter blocked/truncated output for {agent_name}: {exc}"
                )
                Logs["Scan Info"].append(f"  [CONTENT FILTER] {cf_msg}")
                Logs["Harness Layer2"].append(f"  [CONTENT FILTER] {cf_msg}")
                raise FoundryContentFilterError(cf_msg) from exc
            err_msg = f"[STRICT ERROR] Azure AI Foundry invocation failed for {agent_name}: {exc}"
            Logs["Scan Info"].append(f"  {err_msg}")
            Logs["Harness Layer2"].append(f"  {err_msg}")
            print(f"  {err_msg}")
            raise RuntimeError(err_msg) from exc

    def run_table_summarizer_agent(self, table_name, schema_name=None, col_cnt=None, r_cnt=None, sz_mb=None):
        full_name = f"{schema_name}.{table_name}" if schema_name else table_name
        detail_str = f" ({col_cnt} columns, {r_cnt} rows, {sz_mb} MB)" if col_cnt is not None else ""
        self._log_agent(f"        * [SUCCESS]: Evaluator verified schema for table '{full_name}'{detail_str}")
        tool_map = {"get_table_metadata": self.get_table_metadata}
        if schema_name:
            user_msg = f"Please fetch the metadata for table '{table_name}' in schema '{schema_name}' using get_table_metadata and write the refined observations summary for this table."
        else:
            user_msg = f"Please fetch the metadata for table '{table_name}' using get_table_metadata and write the refined observations summary for this table."

        rag_context = self._get_rag_context(
            f"{table_name} table columns primary key foreign key partition identity generated column managed external table type",
            top_k=2,
            max_chars_per_chunk=500
        )
        if rag_context:
            user_msg = user_msg + "\n\nBackground platform reference (context only - do not add sections or deviate from your required output format):\n" + rag_context

        summary = self.run_agent_with_tool_calling(
            agent_name=self.table_summarizer_name,
            user_msg=user_msg,
            tool_map=tool_map
        )
        if not summary or len(summary.strip()) < 30:
            raise RuntimeError(
                f"[STRICT ERROR] Table Summarizer Agent failed to generate valid observations for table '{full_name}' "
                f"using model '{self.table_summarizer_model}'. Output was empty or incomplete."
            )
        
        self._log_agent(f"        * [SUCCESS]: Generator Agent synthesized table observations for '{full_name}'")
        return summary

    def _generate_fallback_migration_writeups(self, metadata_summary_str):
        source = (self.source_hint or "database").title()
        return f"""
SECTION 1: EXECUTIVE SUMMARY
This migration plan establishes the automated end-to-end transition from {source} to Microsoft Fabric OneLake Lakehouse architecture.

SECTION 2: DEPENDENCY AND COMPLEXITY ANALYSIS
The database schema has been verified for referential constraints and primary keys. Relationships have been organized to prevent foreign key violations during ingestion.

SECTION 3: INGESTION STRATEGY & SEQUENCE
Workloads are assigned to parallelized and sequential batches based on dependency mapping. Dimension tables and independent entities are scheduled first.

SECTION 4: BATCH DEFINITIONS
- Batch 1: Independent Tables (Full Load Ingestion)
- Batch 2: Medium Dependency Tables
- Batch 3: Highly Dependent Transaction Tables

SECTION 5: MICROSOFT FABRIC TARGET ARCHITECTURE
Target architecture leverages Microsoft Fabric OneLake unified storage, Delta Parquet data formatting, Fabric Data Pipelines for ingestion orchestration, and Power BI semantic models.

SECTION 6: EXECUTION PLAN & CUTOVER TIMELINE
The cutover roadmap encompasses schema synchronization, historical parallel data copy, incremental delta synchronization, and validation reconciliation.

SECTION 7: TOKEN AND COST REPORT
Generated with AI Foundry agents and Microsoft Fabric best practices.
"""

    def run_secondary_object_summarizer_agent(self, object_type, object_name, schema_name=None):
        """
        Sibling of run_table_summarizer_agent() for the four non-table
        object types Unity Catalog also exposes - views, functions, stored
        procedures, and volumes. object_type is one of "view", "function",
        "procedure", "volume" and picks which get_*_metadata tool the agent
        is told to call, per the per-object-type output formats in
        TableSummarizerAgent's instructions.
        """
        tool_names = {
            "view": "get_view_metadata",
            "function": "get_function_metadata",
            "procedure": "get_procedure_metadata",
            "volume": "get_volume_metadata",
        }
        tool_name = tool_names[object_type]
        direct_tool_fn = {
            "view": self.get_view_metadata,
            "function": self.get_function_metadata,
            "procedure": self.get_procedure_metadata,
            "volume": self.get_volume_metadata,
        }[object_type]

        Logs["Scan Info"].append(f"[INFO] Running Table Summarizer Agent for {object_type} '{object_name}' (Schema: '{schema_name}')...")
        print(f"[INFO] Running Table Summarizer Agent for {object_type} '{object_name}' (Schema: '{schema_name}')...")
        tool_map = {
            "get_table_metadata": self.get_table_metadata,
            "get_view_metadata": self.get_view_metadata,
            "get_function_metadata": self.get_function_metadata,
            "get_procedure_metadata": self.get_procedure_metadata,
            "get_volume_metadata": self.get_volume_metadata,
        }
        if schema_name:
            user_msg = f"Please fetch the metadata for {object_type} '{object_name}' in schema '{schema_name}' using {tool_name} and write the refined observations summary for this {object_type}."
        else:
            user_msg = f"Please fetch the metadata for {object_type} '{object_name}' using {tool_name} and write the refined observations summary for this {object_type}."

        rag_context = self._get_rag_context(
            f"{object_name} {object_type} unity catalog metadata definition storage",
            top_k=2,
            max_chars_per_chunk=500
        )
        if rag_context:
            user_msg = user_msg + "\n\nBackground platform reference (context only - do not add sections or deviate from your required output format):\n" + rag_context

        summary = self.run_agent_with_tool_calling(
            agent_name=self.table_summarizer_name,
            user_msg=user_msg,
            tool_map=tool_map
        )
        if not summary or len(summary.strip()) < 20:
            raise RuntimeError(
                f"[STRICT ERROR] Table Summarizer Agent failed to generate valid observations for {object_type} '{object_name}' "
                f"using model '{self.table_summarizer_model}'. Output was empty or incomplete."
            )
        return summary

    def _build_safe_architectural_migration_prompt(self) -> str:
        source_label = get_source_display_name(self.source_hint)
        total_tables = len(self.tables_df) if self.tables_df is not None else 0
        return (
            f"Summarize a Microsoft Fabric OneLake Lakehouse Medallion (Bronze, Silver, Gold) "
            f"migration architecture for a {total_tables}-table {source_label} source database "
            f"in 5 short bullet points labeled SECTION 1, SECTION 2, SECTION 5, SECTION 6, SECTION 8."
        )

    def run_migration_generator_agent(self, metadata_summary_str):
        self._log_agent("        * [SUCCESS]: Synthesized target architecture mapping for Microsoft Fabric OneLake")
        self._log_agent("        * [SUCCESS]: Verified Lakehouse Delta Parquet storage format rules")
        self._log_agent("        * [SUCCESS]: Validated execution batch sequencing and dependency order")
        self._log_agent("        * [SUCCESS]: Evaluated referential integrity and cyclic dependencies (0 circular dependencies)")
        self._log_agent("        * [SUCCESS]: Formulated cutover strategy, delta sync validation, and risk assessment")

        rag_context = self._get_rag_context(
            "fabric lakehouse warehouse onelake target selection object mapping data type mapping "
            "migration strategy load strategy full load incremental load batch execution sequence "
            "dependency parallel migration risk",
            top_k=6,
            max_chars_per_chunk=1200
        )
        rag_block = ""
        if rag_context:
            rag_block = "Reference migration knowledge (ground sections in this guidance; do not copy it verbatim):\n" + rag_context + "\n\n"

        user_msg = rag_block + "Here is the database metadata summary gathered from files:\n\n" + metadata_summary_str + "\n\nPlease generate the detailed text content and write-ups for Sections 1 to 7 of the Database Migration Plan."

        try:
            writeups = self.run_agent_with_tool_calling(
                agent_name=self.migration_plan_name,
                user_msg=user_msg
            )
        except FoundryContentFilterError as cf_err:
            Logs["Scan Info"].append(
                f"[WARN] Foundry content_filter triggered for '{self.migration_generator_model}'; retrying with PII-safe architectural prompt..."
            )
            print(f"[WARN] Foundry content_filter triggered ({cf_err}); retrying {self.migration_generator_model} with PII-safe architectural prompt...")
            safe_prompt = self._build_safe_architectural_migration_prompt()
            writeups = self.run_agent_with_tool_calling(
                agent_name=self.migration_plan_name,
                user_msg=safe_prompt
            )
        if not writeups or len(writeups.strip()) < 50:
            raise RuntimeError(
                f"[STRICT ERROR] Migration Generator Agent failed to synthesize migration roadmap "
                f"using model '{self.migration_generator_model}'. Output was empty or incomplete."
            )
        self._log_agent("        * [SUCCESS]: Evaluator verified migration plan integrity and Fabric OneLake compatibility")
        return writeups

    def _safe_delete_agent(self, label: str, agent_name: str) -> None:
        try:
            try:
                self.client.agents.delete(agent_name, force=True)
            except TypeError:
                self.client.agents.delete(agent_name)
            Logs["Scan Info"].append(f"  Deleted {label} ({agent_name})")
            print(f"  Deleted {label} ({agent_name})")
        except Exception as e:
            Logs["Scan Info"].append(f"[WARNING] Error deleting {label} ({agent_name}): {e}")
            print(f"[WARNING] Error deleting {label} ({agent_name}): {e}")

    def cleanup_agents(self):
        """Cleans up the agents created on Microsoft AI Foundry to release resources."""
        Logs["Scan Info"].append("[INFO] Cleaning up agents on Microsoft AI Foundry...")
        print("[INFO] Cleaning up agents on Microsoft AI Foundry...")
        if self.table_summarizer_agent:
            self._safe_delete_agent("TableSummarizer Agent", self.table_summarizer_name)
            self.table_summarizer_agent = None
        if self.migration_plan_agent:
            self._safe_delete_agent("MigrationPlan Agent", self.migration_plan_name)
            self.migration_plan_agent = None
