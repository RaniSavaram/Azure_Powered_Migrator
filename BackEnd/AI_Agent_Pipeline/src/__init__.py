import sys
import os
sys.path.append(os.path.dirname(__file__))

from .metadataProcessor import (
    collect_metadata,
    count_table_columns,
    metadata_to_dataframes,
    read_csv_robust,
    read_json_robust,
    infer_sql_type
)
from .agents import (
    TableSummarizerAgent,
    MigrationGeneratorAgent
)
from .orchestrator import AzureAIOrchestrator
from .docx_generator import (
    create_table_summary_document,
    create_migration_plan_document
)
from .timezone_utils import (
    now_in_client_tz,
    format_doc_timestamp,
    set_client_timezone_context,
    reset_client_timezone_context,
)

__all__ = [
    "collect_metadata",
    "metadata_to_dataframes",
    "read_csv_robust",
    "read_json_robust",
    "infer_sql_type",
    "TableSummarizerAgent",
    "MigrationGeneratorAgent",
    "AzureAIOrchestrator",
    "create_table_summary_document",
    "create_migration_plan_document"
]