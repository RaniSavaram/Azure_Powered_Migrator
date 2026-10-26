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
  warehouseHost?: string;
  authMode?: 'servicePrincipal' | 'default';
}

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
    tenant_id?: string;
    client_id?: string;
    client_secret?: string;
    account?: string;
    warehouse?: string;
    role?: string;
    token?: string;
    workspace_id?: string;
    lakehouse_name?: string;
    lakehouse_id?: string;
    warehouse_name?: string;
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
    if (connection.personalAccessToken) extra.personalAccessToken = connection.personalAccessToken;

    const payload = {
      source,
      platform: source,
      server: connection.server,
      database: connection.database,
      catalog: connection.catalog,
      username: connection.username,
      password: connection.password,
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
   * Phase 2 (Constraint & Governance): Evaluates Layer 1 Harness rules, constraints, and Fabric compatibility.
   */
  validateConstraints() {
    return this.http.post<{
      status: string;
      decision: string;
      compliance_score: number;
      rules: Array<{ id: string; desc: string; status: 'pass' | 'warn' | 'fail' | 'info' }>;
      metrics: Array<{ label: string; value: string }>;
      remediations: string;
      report_text: string;
      harness_result: any;
    }>(`${this.api.baseUrl}/validate-constraints/`, {});
  }

  /**
   * Phase 3 (Assessment Agent): Generates Table-Wise Summaries, sizing classification, and Word Assessment Report.
   */
  generateAssessmentReport() {
    return this.http.post<{
      status: string;
      report_file: string;
      report_url: string;
      download_url: string;
      summary: {
        total_tables: number;
        total_columns: number;
        total_size_mb: number;
        total_rows: number;
        top_tables_by_size: string[];
        top_tables_by_rows: string[];
        complexity_breakdown: {
          simple: number;
          medium: number;
          complex: number;
        };
      };
      table_assessments: Array<{
        name: string;
        schema: string;
        row_count: number;
        size_mb: number;
        size_category: string;
        complexity: string;
        direct_lake_ready: boolean;
      }>;
    }>(`${this.api.baseUrl}/assessment-report/`, {});
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
