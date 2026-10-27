import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Api } from '../api/api';

export interface ConnectionDetails {
  server: string;
  database: string;
  username: string;
  password: string;
  /** Databricks-only: SQL warehouse endpoint, sent to Django as extra.http_path */
  httpPath?: string;
  /** Dynamics 365-only: Azure AD tenant ID, sent to Django as extra.tenant_id */
  tenantId?: string;
  /** Dynamics 365-only: app registration (client) ID, sent to Django as extra.client_id */
  clientId?: string;
  /** Dynamics 365-only: app registration client secret, sent to Django as extra.client_secret */
  clientSecret?: string;
  /** Snowflake-only: account identifier (e.g. "xy12345.us-east-1"), sent to Django as extra.account */
  account?: string;
  /** Snowflake-only: compute warehouse name, sent to Django as extra.warehouse */
  warehouse?: string;
  /** Snowflake-only: optional role to assume, sent to Django as extra.role */
  role?: string;
  /** Snowflake-only: Programmatic Access Token (PAT), sent to Django as extra.token - when set, connects without username/password */
  token?: string;
}

export interface FabricConnectionDetails {
  workspaceId: string;
  lakehouseName?: string;
  lakehouseId?: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  warehouseName?: string;
  warehouseId?: string;
  warehouseHost?: string;
  authMode?: 'servicePrincipal' | 'default';
}

export type ConstraintRuleStatus = 'pass' | 'warn' | 'fail' | 'info';
export type ConstraintLogLevel = 'INFO' | 'STEP' | 'PASS' | 'WARN' | 'ERROR' | 'FAIL' | 'RESULT';

export interface ConstraintRule {
  id: string;
  category: 'keys' | 'datatypes' | 'destructive' | 'governance' | 'structure';
  desc: string;
  status: ConstraintRuleStatus;
  count: number;
  objects: string[];
  skipped?: boolean;
}

export interface ConstraintLogLine {
  time: string;
  level: ConstraintLogLevel;
  step: string;
  text: string;
}

export interface ConstraintTableDetail {
  schema: string;
  name: string;
  columns: number;
  row_count?: number | null;
  primary_key: string[];
  keys_declared: boolean;
  foreign_keys: Array<{ name: string; columns: string[]; references: string; references_columns: string[] }>;
}

/** Response of POST /api/validate-constraints/ (HarnessLayers/layer1/constraint_report.py). */
export interface ConstraintReport {
  status: 'success' | 'error';
  code?: 'SOURCE_NOT_CONNECTED' | 'CONNECTION_FAILED';
  message?: string;
  decision: 'PASS' | 'FAIL';
  next_step?: string;
  compliance_score: number;
  score_basis?: string;
  generated_at?: string;
  duration_ms?: number;
  reconnected?: boolean;
  source: {
    platform: string;
    platform_slug: string;
    server: string;
    database: string;
    live_connected: boolean;
    is_demo: boolean;
    metadata_origin: 'live' | 'demo' | 'catalog_fallback' | null;
    metadata_extracted_at?: string | null;
  };
  summary: { tables: number; views: number; procedures: number; columns: number; errors: number; warnings: number };
  keys: {
    declared: boolean;
    tables_with_pk: number;
    tables_checked: number;
    tables_without_pk: string[];
    pk_coverage: number | null;
    fk_total: number;
    fk_valid: number;
    fk_out_of_scope: number;
    fk_broken: number;
    fk_integrity: number | null;
  };
  type_findings: Array<{ table: string; column: string; source_type: string; fabric_type: string; status: 'unsupported' | 'unknown' }>;
  sensitive_columns: Array<{ table: string; column: string }>;
  destructive_statements: Array<{ table: string; statement: string }>;
  metrics: Array<{ label: string; value: string; color?: string }>;
  rules: ConstraintRule[];
  sections: Array<{ section: string; title: string; passed: boolean; errors: number; warnings: number }>;
  tables: Record<string, ConstraintTableDetail>;
  remediations: string;
  logs: ConstraintLogLine[];
  report_text: string;
  harness_result: unknown;
}

export type AssessmentTier = 'Simple' | 'Medium' | 'Complex';
export type AssessmentReadiness = 'ready' | 'needs_review' | 'blocked';

export interface AssessmentTable {
  key: string;
  schema: string;
  name: string;
  row_count: number;
  size_mb: number;
  columns: number;
  primary_key: string[];
  keys_declared: boolean;
  references: string[];
  referenced_by: number;
  type_changes: Array<{ column: string; source_type: string; fabric_type: string }>;
  sensitive_columns: string[];
  watermark_candidates: string[];
  load_strategy: string;
  direct_lake_ready: boolean;
  complexity_score: number;
  complexity: AssessmentTier;
  score_factors: Array<{ factor: string; points: number }>;
  readiness: AssessmentReadiness;
  blocking_issues: string[];
  wave?: number;
}

/** Response of POST /api/assessment-report/ (BackEnd/Migrator/assessment_analysis.py). */
export interface AssessmentReport {
  status: 'success' | 'error';
  code?: 'SOURCE_NOT_CONNECTED' | 'CONNECTION_FAILED';
  message?: string;
  generated_at?: string;
  duration_ms?: number;
  reconnected?: boolean;
  source: ConstraintReport['source'];
  verdict: 'ready' | 'ready_with_review' | 'blocked';
  report_file: string | null;
  report_url: string | null;
  download_url: string | null;
  document_error: string | null;
  summary: {
    total_tables: number;
    total_views: number;
    total_procedures: number;
    total_columns: number;
    total_rows: number;
    total_size_mb: number;
    est_onelake_size_mb: number;
    complexity_breakdown: { simple: number; medium: number; complex: number };
    readiness_breakdown: Record<AssessmentReadiness, number>;
    readiness_pct: number;
    wave_count: number;
    dependency_source: 'declared' | 'inferred' | 'none';
    tables_in_cycles: string[];
    incremental_candidates: number;
    direct_lake_over_guardrail: string[];
    constraints_gate: 'PASS' | 'FAIL' | 'NOT_RUN';
    top_tables_by_size: string[];
    top_tables_by_rows: string[];
  };
  metrics: Array<{ label: string; value: string; color?: string }>;
  tables: Record<string, AssessmentTable>;
  waves: Array<{ wave: number; tables: string[] }>;
  logs: ConstraintLogLine[];
  table_assessments: Array<{ name: string; schema: string; row_count: number; size_mb: number; size_category: string; complexity: string; direct_lake_ready: boolean }>;
}

/** localStorage key shared by every screen that reads/writes the Fabric destination. */
export const FABRIC_DESTINATION_STORAGE_KEY = 'dbscanner.fabricConnection';

export interface ConnectResponse {
  status: string;
  message: string;
  source?: string;
  connected?: boolean;
  connection_status?: string;
  error?: string;
  logs?: string[];
  connection_logs?: string[];
  config?: any;
}

export interface SavedConnectionProfile {
  server: string;
  database: string;
  username: string;
  password: string;
  extra?: {
    http_path?: string;
    httpPath?: string;
    tenant_id?: string;
    client_id?: string;
    client_secret?: string;
    account?: string;
    warehouse?: string;
    role?: string;
    token?: string;
    personalAccessToken?: string;
    workspace_id?: string;
    lakehouse_name?: string;
    lakehouse_id?: string;
    warehouse_name?: string;
    warehouse_id?: string;
    warehouse_connection_string?: string;
    auth_mode?: string;
  };
}

export interface SavedConnectionResponse {
  status: string;
  found: boolean;
  connection?: SavedConnectionProfile;
}

export interface SavedConnectionsResponse {
  status: string;
  connections: SavedConnectionProfile[];
}

export interface StartScanResponse {
  status: string;
  message?: string;
  scan_id?: string;
}

export interface ScanStatus {
  'token info': Array<{
    total?: number;
    prompt?: number;
    completion?: number;
    cost?: string;
  }>;
  'scan info': string[];
  progressbar: number;
  scan_status_message?: string;
  status?: 'Running' | 'Completed' | 'Failed';
  error?: string;
  source?: string;
  destination?: string;
  tables_found?: number;
  scan_id?: string;
  Logs?: Record<string, unknown>;
  result?: {
    output_files?: {
      assessment_report?: string;
      migration_plan?: string;
      fabric_migration_metadata?: string;
    };
  };
}

export interface ErColumn {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  fk: boolean;
}

export interface ErTable {
  id: string;
  schema: string;
  name: string;
  row_count?: number | null;
  primary_key?: string | null;
  /** True when the primary key is declared in the source, not guessed. */
  primary_key_declared: boolean;
  columns: ErColumn[];
}

export interface ErRelationship {
  from: string;
  /** Comma-separated for a composite foreign key. */
  from_column: string;
  to: string;
  to_column?: string | null;
  /** Foreign key constraint name, for declared relationships. */
  name?: string | null;
  inferred: boolean;
}

export interface ErDiagramResponse {
  status: string;
  file: string;
  source?: string;
  database?: string;
  generated_at?: string;
  /** Whether the scan could read the source's declared keys at all. */
  declared_keys_read: boolean;
  /** Declared foreign keys, or (when there are none) inferred from column names. */
  relationship_source: 'declared' | 'inferred';
  tables: ErTable[];
  relationships: ErRelationship[];
}

export interface CompletedScanInfo {
  source: string;
  metadataFile?: string;
  reportFile?: string;
  planFile?: string;
  timestamp: Date;
}

@Injectable({ providedIn: 'root' })
export class Scanner {
  private http = inject(HttpClient);
  private api = inject(Api);

  readonly lastCompletedScan = signal<CompletedScanInfo | null>(null);
  readonly openConnectionRequest = signal<{ source: string; timestamp: number } | null>(null);

  /**
   * Destination Fabric workspace that Generate Artifacts deploys into. Set
   * from the Artifacts Generator's "Start conversation" dialog (or the DB
   * Scanner's own Fabric dialog) and read back when artifacts are generated.
   */
  readonly fabricDestination = signal<FabricConnectionDetails | null>(this.readStoredFabricDestination());

  setFabricDestination(fabric: FabricConnectionDetails | null, persist = true) {
    this.fabricDestination.set(fabric ? { ...fabric } : null);
    try {
      if (fabric && persist) {
        localStorage.setItem(FABRIC_DESTINATION_STORAGE_KEY, JSON.stringify(fabric));
      } else {
        localStorage.removeItem(FABRIC_DESTINATION_STORAGE_KEY);
      }
    } catch {}
  }

  getFabricDestination(): FabricConnectionDetails | null {
    const current = this.fabricDestination();
    return current ? { ...current } : null;
  }

  private readStoredFabricDestination(): FabricConnectionDetails | null {
    try {
      const raw = localStorage.getItem(FABRIC_DESTINATION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.workspaceId) {
        return {
          workspaceId: parsed.workspaceId,
          lakehouseName: parsed.lakehouseName || '',
          lakehouseId: parsed.lakehouseId || '',
          tenantId: parsed.tenantId || '',
          clientId: parsed.clientId || '',
          clientSecret: parsed.clientSecret || '',
          warehouseName: parsed.warehouseName || '',
          warehouseId: parsed.warehouseId || '',
          warehouseHost: parsed.warehouseHost || '',
          authMode: parsed.authMode || 'servicePrincipal',
        };
      }
    } catch {}
    return null;
  }

  requestOpenConnection(source: string) {
    this.openConnectionRequest.set({ source, timestamp: Date.now() });
  }

  setCompletedScan(info: CompletedScanInfo) {
    this.lastCompletedScan.set(info);
    try {
      sessionStorage.setItem('apexon_active_scan', JSON.stringify({
        source: info.source,
        metadataFile: info.metadataFile,
        reportFile: info.reportFile,
        planFile: info.planFile,
        timestamp: info.timestamp
      }));
    } catch {}
  }

  getCompletedScan(): CompletedScanInfo | null {
    const current = this.lastCompletedScan();
    if (current) return current;
    try {
      const raw = sessionStorage.getItem('apexon_active_scan');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          source: parsed.source,
          metadataFile: parsed.metadataFile,
          reportFile: parsed.reportFile,
          planFile: parsed.planFile,
          timestamp: new Date(parsed.timestamp)
        };
      }
    } catch {}
    return null;
  }

  /**
   * Calls Django's connect_database view.
   * NOTE: that view reads FLAT fields off the request body
   * (request.data.get("server"), .get("database"), etc.) - not a nested
   * "connection" object - so the payload here is deliberately flat to match.
   */
  connectDatabase(source: string, connection: any, rememberMe = false) {
    const extra: any = { ...(connection.extra || {}) };
    if (connection.httpPath) extra.http_path = connection.httpPath;
    if (connection.http_path) extra.http_path = connection.http_path;
    if (connection.tenantId) extra.tenant_id = connection.tenantId;
    if (connection.tenant_id) extra.tenant_id = connection.tenant_id;
    if (connection.clientId) extra.client_id = connection.clientId;
    if (connection.client_id) extra.client_id = connection.client_id;
    if (connection.clientSecret) extra.client_secret = connection.clientSecret;
    if (connection.client_secret) extra.client_secret = connection.client_secret;
    if (connection.account) extra.account = connection.account;
    if (connection.warehouse) extra.warehouse = connection.warehouse;
    if (connection.role) extra.role = connection.role;
    if (connection.token) extra.token = connection.token;
    if (connection.personalAccessToken) {
      extra.personalAccessToken = connection.personalAccessToken;
      if (!extra.token) extra.token = connection.personalAccessToken;
    }

    const effectivePassword = connection.password || connection.personalAccessToken || connection.token;
    const effectiveDatabase = connection.database || connection.catalog;

    const payload = {
      source,
      platform: source,
      server: connection.server,
      database: effectiveDatabase,
      catalog: connection.catalog || effectiveDatabase,
      username: connection.username,
      password: effectivePassword,
      port: connection.port,
      extra,
      remember_me: rememberMe || connection.remember_me || connection.rememberMe,
      demo_mode: connection.demo_mode || connection.demoMode
    };
    return this.http.post<ConnectResponse>(`${this.api.baseUrl}/connect/`, payload);
  }

  /**
   * Looks up the last-saved connection details for a source (Django saves
   * them automatically after a successful connectDatabase() call), so the
   * connect form can be pre-filled instead of starting blank every time.
   */
  getSavedConnection(source: string) {
    return this.http.get<SavedConnectionResponse>(`${this.api.baseUrl}/connection/`, {
      params: { source },
    });
  }

  /**
   * Looks up every saved connection profile for a source (e.g. all known
   * Databricks servers), so the connect form can offer a dropdown picker
   * instead of pre-filling from just the last-used one.
   */
  getSavedConnections(source: string) {
    return this.http.get<SavedConnectionsResponse>(`${this.api.baseUrl}/connections/`, {
      params: { source },
    });
  }

  /**
   * Calls Django's start_scan view, which kicks the scan off in a
   * background thread and returns immediately with a scan_id. Use
   * getScanStatus() below to poll for progress until it completes.
   */
  startScan(source: string, destination: string, connection: ConnectionDetails) {
    const payload = {
      source,
      destination,
      connection,
    };
    return this.http.post<StartScanResponse>(`${this.api.baseUrl}/scan/`, payload);
  }

  /**
   * Polled on an interval while a scan is running. Matches Django's
   * scan_status view, which returns the logs dict:
   * {"token info": [...], "scan info": [...], "progressbar": int, "status": ...}
   */
  getScanStatus(scanId: string) {
    return this.http.get<ScanStatus>(`${this.api.baseUrl}/scan-status/${scanId}/`);
  }

  /**
   * Tables, columns, keys, and relationships for the logs dialog's
   * "ER Diagrams" tab, built by Django's er_diagram view from a finished
   * scan's Fabric metadata JSON (output_files.fabric_migration_metadata).
   * Without a file, Django falls back to the most recent scan's copy.
   */
  getErDiagram(file?: string) {
    return this.http.get<ErDiagramResponse>(`${this.api.baseUrl}/er-diagram/`, {
      params: file ? { file } : {},
    });
  }

  /**
   * Validates and saves Microsoft Fabric destination credentials and workspace configuration.
   */
  connectFabric(fabric: FabricConnectionDetails, rememberMe = false) {
    return this.http.post<{
      status: string;
      message: string;
      details?: any;
      fabric?: any;
    }>(`${this.api.baseUrl}/connect-fabric/`, {
      workspace_id: fabric.workspaceId,
      tenant_id: fabric.tenantId,
      client_id: fabric.clientId,
      client_secret: fabric.clientSecret,
      lakehouse_name: fabric.lakehouseName,
      lakehouse_id: fabric.lakehouseId,
      warehouse_name: fabric.warehouseName,
      warehouse_id: fabric.warehouseId,
      warehouse_host: fabric.warehouseHost,
      auth_mode: fabric.authMode || 'servicePrincipal',
      remember_me: rememberMe,
    });
  }

  /**
   * Invokes the source's BackEnd/Artifacts_Generator/*2_fabric.py script
   * (databricks2_fabric.py / sqlserver2_fabric.py / dynamics3652_fabric.py)
   * to deploy the scanned Tables, Views, Stored Procedures, and Volumes
   * directly into Microsoft Fabric.
   */
  generateFabricArtifacts(source?: string, filename?: string, fabricConfig?: FabricConnectionDetails) {
    const payload: any = { source, filename };
    if (fabricConfig) {
      payload.fabric = {
        workspace_id: fabricConfig.workspaceId,
        tenant_id: fabricConfig.tenantId,
        client_id: fabricConfig.clientId,
        client_secret: fabricConfig.clientSecret,
        lakehouse_name: fabricConfig.lakehouseName,
        lakehouse_id: fabricConfig.lakehouseId,
        warehouse_name: fabricConfig.warehouseName,
        warehouse_id: fabricConfig.warehouseId,
        warehouse_connection_string: fabricConfig.warehouseHost,
      };
    }
    return this.http.post<{
      status: string;
      message: string;
      tables?: string[];
      errors?: string[];
      logs?: string[];
      tables_info?: any[];
      target?: any;
      lakehouse_name?: string;
      warehouse?: any;
      pipeline?: any;
    }>(
      `${this.api.baseUrl}/generate-fabric-artifacts/`,
      payload
    );
  }

  /**
   * Phase 1 (Discovery): Extracts schema metadata, table sizing, and ER relations.
   */
  extractMetadata(payload?: any) {
    return this.http.post<{
      status: string;
      connected?: boolean;
      error?: string;
      message?: string;
      connection_status?: string;
      connection_message?: string;
      connection_logs?: string[];
      logs?: string[];
      live_connected?: boolean;
      platform: string;
      server?: string;
      database: string;
      summary?: {
        tables: number;
        views: number;
        procedures: number;
        functions: number;
        volumes: number;
        columns: number;
        total_rows: number;
        total_volume_mb: number;
        est_fabric_volume_mb: number;
        compression_ratio: string;
        schemas: string[];
      };
      tables?: any[];
      views?: any[];
      procedures?: any[];
      er_summary?: {
        nodes: number;
        edges: number;
        cycles: number;
      };
      next_step?: {
        phase: number;
        agent: string;
        route: string;
        instruction: string;
      };
    }>(`${this.api.baseUrl}/extract-metadata/`, payload || {});
  }

  /**
   * Phase 2 (Constraint & Governance): runs Harness Layer 1 on the connected
   * source's metadata. `connection` lets the backend reconnect and
   * re-extract when it holds no metadata (e.g. after a restart); `refresh`
   * forces a fresh extraction from the source before checking.
   */
  validateConstraints(options: { connection?: Record<string, unknown>; refresh?: boolean } = {}) {
    return this.http.post<ConstraintReport>(`${this.api.baseUrl}/validate-constraints/`, options);
  }

  /**
   * Phase 3 (Assessment Agent): per-table readiness, complexity, load
   * strategy and migration waves, plus the Assessment Report (.docx).
   * `connection` / `refresh` work as for validateConstraints();
   * `generate_document: false` refreshes the analysis without rebuilding the Word file.
   */
  generateAssessmentReport(options: { connection?: Record<string, unknown>; refresh?: boolean; generate_document?: boolean } = {}) {
    return this.http.post<AssessmentReport>(`${this.api.baseUrl}/assessment-report/`, options);
  }

  /**
   * Phase 4/5 (Migration Plan Generator): Synthesizes Medallion architecture, execution waves, Word Migration Plan, and migration_plan.json.
   */
  generateMigrationPlan() {
    return this.http.post<{
      status: string;
      plan_file: string;
      plan_url: string;
      download_url: string;
      json_plan_file: string;
      medallion_architecture: {
        bronze: string[];
        silver: string[];
        gold: string[];
      };
      execution_waves: Array<{
        wave: number;
        name: string;
        tables: string[];
      }>;
      risk_mitigations: Array<{
        risk: string;
        mitigation: string;
      }>;
    }>(`${this.api.baseUrl}/migration-plan/`, {});
  }

  /**
   * Telemetry state across all phases.
   */
  getPipelineState() {
    return this.http.get<{
      source_connected: boolean;
      platform: string;
      platform_slug: string;
      server: string;
      database: string;
      connected_at: string;
      has_metadata: boolean;
      metadata_summary: any;
      has_constraints: boolean;
      has_assessment: boolean;
      assessment_report_file?: string;
      has_migration_plan: boolean;
      migration_plan_file?: string;
    }>(`${this.api.baseUrl}/pipeline-state/`);
  }
}
