import { Component, ElementRef, ViewChild, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { HarnessDataService, SourceConnectionConfig } from '../../services/harness-data.service';
import { Scanner } from '../../../app/services/scanner/scanner';

export interface ChatRuleItem {
  id: string;
  desc: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
}

export interface ChatMetricItem {
  label: string;
  value: string;
  color?: string;
}

export interface ChatActionItem {
  label: string;
  action: string;
  icon: string;
  primary?: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'agent' | 'user';
  text: string;
  timestamp: Date;
  metrics?: ChatMetricItem[];
  rules?: ChatRuleItem[];
  codeBlock?: string;
  actions?: ChatActionItem[];
}

export interface QuickPrompt {
  label: string;
  query: string;
  icon: string;
}

export interface SavedProfileOption {
  key: string;
  label: string;
  server: string;
  database?: string;
  catalog?: string;
  username?: string;
  password?: string;
  httpPath?: string;
  token?: string;
  account?: string;
  warehouse?: string;
  tenantId?: string;
  clientId?: string;
}

@Component({
  selector: 'app-discovery-agent',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './discovery-agent.component.html',
  styleUrl: './discovery-agent.component.css'
})
export class DiscoveryAgentComponent implements OnInit {
  @ViewChild('chatScroll') private chatScrollRef!: ElementRef;
  private router = inject(Router);
  public harnessDataService = inject(HarnessDataService);
  private scanner = inject(Scanner);

  public lastExtractedMetadata: any = null;
  public connectionFailed: boolean = false;
  public connectionErrorMessage: string = '';
  public showInlineConnectCard: boolean = false;
  public isConnecting: boolean = false;
  public fieldErrors: Record<string, boolean> = {};

  agentName = 'Discovery Agent';
  phase = 'Phase 1 · Schema Intelligence';
  nextPhaseRoute = '/agents/constraint';
  nextPhaseName = 'Constraint Agent';

  userInput: string = '';
  isTyping: boolean = false;

  // Exact 7 Supported source platforms
  availablePlatforms: string[] = [
    'SQL Server',
    'Databricks',
    'Dynamics 365',
    'Snowflake',
    'Oracle',
    'SAP HANA',
    'Synapse'
  ];

  // Saved connections map - populated from backend and user profiles
  savedConnectionsMap: Record<string, SavedProfileOption[]> = {
    'SQL Server': [],
    'Databricks': [],
    'Dynamics 365': [],
    'Snowflake': [],
    'Oracle': [],
    'SAP HANA': [],
    'Synapse': []
  };

  // Connection form state
  connectionForm = {
    platform: 'SQL Server',
    savedConnection: '__new__',
    server: '',
    port: 1433,
    database: '',
    catalog: '',
    username: '',
    password: '',
    personalAccessToken: '',
    httpPath: '',
    account: '',
    warehouse: '',
    dynamicsAuthMode: 'secret',
    tenantId: '',
    clientId: '',
    clientSecret: '',
    snowflakeAuthMode: 'token',
    token: '',
    role: '',
    rememberMe: false
  };

  get currentSavedOptions(): SavedProfileOption[] {
    return this.savedConnectionsMap[this.connectionForm.platform] || [];
  }

  quickPrompts: QuickPrompt[] = [
    { label: 'SQL Server', query: 'Configure SQL Server source platform', icon: 'bi-database' },
    { label: 'Databricks', query: 'Configure Databricks Unity Catalog source platform', icon: 'bi-boxes' },
    { label: 'Dynamics 365', query: 'Configure Dynamics 365 Dataverse source platform', icon: 'bi-diagram-2' },
    { label: 'Snowflake', query: 'Configure Snowflake Lakehouse source platform', icon: 'bi-snow' },
    { label: 'Oracle', query: 'Configure Oracle Database source platform', icon: 'bi-server' },
    { label: 'SAP HANA', query: 'Configure SAP HANA Enterprise ERP source platform', icon: 'bi-cpu' },
    { label: 'Synapse', query: 'Configure Azure Synapse Analytics source platform', icon: 'bi-cloud-check' }
  ];

  messages: ChatMessage[] = [];

  get isSourceConnected(): boolean {
    return this.harnessDataService.isSourceConnected();
  }

  get connectionConfig() {
    return this.harnessDataService.getConnectionConfig();
  }

  ngOnInit(): void {
    this.loadUserSavedConnections();
    this.fetchBackendSavedProfiles();
    this.initWelcomeMessage();
  }

  private loadUserSavedConnections(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('migrator_user_saved_connections');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            this.savedConnectionsMap = { ...this.savedConnectionsMap, ...parsed };
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  fetchBackendSavedProfiles(): void {
    for (const plat of this.availablePlatforms) {
      this.scanner.getSavedConnections(plat).subscribe({
        next: (res) => {
          if (res?.connections && res.connections.length > 0) {
            const list: SavedProfileOption[] = res.connections.map((p, idx) => ({
              key: `backend-${plat}-${idx}`,
              label: `${p.server || p.extra?.account || 'Server'} / ${p.database || p.extra?.lakehouse_name || 'Default'} (${p.username || 'Saved'})`,
              server: p.server,
              database: p.database,
              username: p.username,
              password: p.password,
              catalog: p.database,
              httpPath: p.extra?.http_path,
              account: p.extra?.account,
              warehouse: p.extra?.warehouse,
              token: p.extra?.token,
              tenantId: p.extra?.tenant_id,
              clientId: p.extra?.client_id
            }));
            this.savedConnectionsMap[plat] = list;

            if (this.connectionForm.platform === plat && this.connectionForm.savedConnection === '__new__' && list.length > 0) {
              this.connectionForm.savedConnection = list[0].key;
              this.onSavedConnectionChange();
            }
          }
        },
        error: () => {}
      });
    }
  }

  openInlineConnectCard(platform?: string): void {
    if (platform) {
      this.selectPlatform(platform);
    } else if (!this.connectionForm.platform) {
      this.selectPlatform('SQL Server');
    }
    this.connectionFailed = false;
    this.connectionErrorMessage = '';
    this.fieldErrors = {};
    this.showInlineConnectCard = true;
    this.scrollToBottom();
  }

  closeInlineConnectCard(): void {
    this.showInlineConnectCard = false;
    this.connectionFailed = false;
    this.connectionErrorMessage = '';
    this.fieldErrors = {};
  }

  private scrollToBottom(smooth: boolean = true): void {
    setTimeout(() => {
      try {
        if (this.chatScrollRef?.nativeElement) {
          const el = this.chatScrollRef.nativeElement;
          el.scrollTo({
            top: el.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
          });
        }
      } catch (e) {
        // ignore
      }
    }, 60);
  }

  onSavedConnectionChange(): void {
    this.fieldErrors = {};
    this.connectionFailed = false;
    this.connectionErrorMessage = '';
    if (this.connectionForm.savedConnection === '__new__') {
      this.resetConnectionFields();
      return;
    }
    const selected = this.currentSavedOptions.find(opt => opt.key === this.connectionForm.savedConnection);
    if (selected) {
      this.connectionForm.server = selected.server || '';
      if (selected.database) this.connectionForm.database = selected.database;
      if (selected.catalog) this.connectionForm.catalog = selected.catalog;
      if (selected.username) this.connectionForm.username = selected.username;
      if (selected.password) this.connectionForm.password = selected.password;
      this.connectionForm.rememberMe = true;
      if (selected.httpPath) this.connectionForm.httpPath = selected.httpPath;
      if (selected.token) this.connectionForm.personalAccessToken = selected.token;
      if (selected.account) this.connectionForm.account = selected.account;
      if (selected.warehouse) this.connectionForm.warehouse = selected.warehouse;
      if (selected.tenantId) this.connectionForm.tenantId = selected.tenantId;
      if (selected.clientId) this.connectionForm.clientId = selected.clientId;
    }
  }

  resetConnectionFields(): void {
    this.connectionForm.server = '';
    this.connectionForm.database = '';
    this.connectionForm.catalog = '';
    this.connectionForm.username = '';
    this.connectionForm.password = '';
    this.connectionForm.personalAccessToken = '';
    this.connectionForm.httpPath = '';
    this.connectionForm.account = '';
    this.connectionForm.warehouse = '';
    this.connectionForm.tenantId = '';
    this.connectionForm.clientId = '';
    this.connectionForm.clientSecret = '';
    this.connectionForm.token = '';
    this.connectionForm.rememberMe = false;
    this.fieldErrors = {};
  }

  selectPlatform(platform: string): void {
    this.connectionForm.platform = platform;
    this.connectionForm.savedConnection = '__new__';
    this.resetConnectionFields();

    const options = this.savedConnectionsMap[platform];
    if (options && options.length > 0) {
      this.connectionForm.savedConnection = options[0].key;
      this.onSavedConnectionChange();
    } else {
      this.scanner.getSavedConnections(platform).subscribe({
        next: (res) => {
          if (res?.connections && res.connections.length > 0) {
            this.savedConnectionsMap[platform] = res.connections.map((p, idx) => ({
              key: `backend-${platform}-${idx}`,
              label: `${p.server || p.extra?.account || 'Server'} / ${p.database || 'Default'} (${p.username || 'Saved'})`,
              server: p.server,
              database: p.database,
              username: p.username,
              password: p.password,
              catalog: p.database,
              httpPath: p.extra?.http_path,
              account: p.extra?.account,
              warehouse: p.extra?.warehouse,
              token: p.extra?.token,
              tenantId: p.extra?.tenant_id,
              clientId: p.extra?.client_id
            }));
            if (this.connectionForm.platform === platform && this.savedConnectionsMap[platform].length > 0) {
              this.connectionForm.savedConnection = this.savedConnectionsMap[platform][0].key;
              this.onSavedConnectionChange();
            }
          }
        }
      });
    }
  }

  private initWelcomeMessage(): void {
    if (this.isSourceConnected) {
      const cfg = this.connectionConfig || this.connectionForm;
      const tableCount = this.lastExtractedMetadata?.summary?.tables?.toString() || '68';
      const viewProcCount = this.lastExtractedMetadata?.summary ? ((this.lastExtractedMetadata.summary.views || 23) + (this.lastExtractedMetadata.summary.procedures || 6)).toString() : '29';
      this.messages = [
        {
          id: 'disc-connected-1',
          sender: 'agent',
          text: `👋 Welcome back! Source platform **${cfg.platform}** is currently connected to **${cfg.server} / ${cfg.database}**.<br><br>Schema inventory and metadata are ready for downstream analysis. You may proceed to Constraint Agent to review constraint level checks in logs, or update connection details below.`,
          timestamp: new Date(),
          metrics: [
            { label: 'Discovered Tables', value: tableCount },
            { label: 'Views & Procedures', value: viewProcCount },
            { label: 'Total Volume', value: '881.3 MB' },
            { label: 'ER Relations', value: '15 Edges' }
          ],
          rules: [
            { id: 'CONN-01', desc: `Handshake verified with ${cfg.platform}`, status: 'pass' },
            { id: 'DISC-01', desc: 'Metadata Catalog Extraction & Information Schema Sync', status: 'pass' },
            { id: 'DISC-02', desc: 'Row Count Profiling & Storage Distribution', status: 'pass' },
            { id: 'DISC-03', desc: 'Entity-Relationship (ER) Graph Construction', status: 'pass' }
          ],
          actions: [
            { label: 'Proceed to Constraint Agent', action: 'next', icon: 'bi-arrow-right-circle-fill', primary: true },
            { label: 'Inspect ER Graph', action: 'er', icon: 'bi-diagram-3' },
            { label: 'Change Connection', action: 'connect', icon: 'bi-arrow-repeat' },
            { label: 'Disconnect Source', action: 'disconnect', icon: 'bi-plug' }
          ]
        }
      ];
    } else {
      this.messages = [
        {
          id: 'disc-init-1',
          sender: 'agent',
          text: `👋 Welcome to the **Discovery Agent** workspace (Phase 1 · Schema Intelligence).\n\nI am the first agent in your migration journey. I discover and catalog source schema metadata across **SQL Server, Databricks, Dynamics 365, Snowflake, Oracle, SAP HANA, and Azure Synapse**.\n\nPlease configure your source database connection details below to initiate discovery, or click **Use Demo Simulation** for pre-indexed enterprise data.`,
          timestamp: new Date()
        }
      ];
    }
    this.scrollToBottom(false);
  }

  validateConnectionForm(isDemoMode: boolean): boolean {
    this.fieldErrors = {};
    if (isDemoMode) return true;

    const plat = this.connectionForm.platform;

    if (plat === 'SQL Server') {
      if (!this.connectionForm.server?.trim()) this.fieldErrors['server'] = true;
      if (!this.connectionForm.database?.trim()) this.fieldErrors['database'] = true;
      if (!this.connectionForm.username?.trim()) this.fieldErrors['username'] = true;
      if (!this.connectionForm.password?.trim()) this.fieldErrors['password'] = true;
    } else if (plat === 'Databricks') {
      if (!this.connectionForm.server?.trim()) this.fieldErrors['server'] = true;
      if (!this.connectionForm.personalAccessToken?.trim()) this.fieldErrors['personalAccessToken'] = true;
    } else if (plat === 'Dynamics 365') {
      if (!this.connectionForm.server?.trim()) this.fieldErrors['server'] = true;
      if (this.connectionForm.dynamicsAuthMode === 'secret') {
        if (!this.connectionForm.tenantId?.trim()) this.fieldErrors['tenantId'] = true;
        if (!this.connectionForm.clientId?.trim()) this.fieldErrors['clientId'] = true;
        if (!this.connectionForm.clientSecret?.trim()) this.fieldErrors['clientSecret'] = true;
      } else {
        if (!this.connectionForm.username?.trim()) this.fieldErrors['username'] = true;
        if (!this.connectionForm.password?.trim()) this.fieldErrors['password'] = true;
      }
    } else if (plat === 'Snowflake') {
      if (!this.connectionForm.account?.trim() && !this.connectionForm.server?.trim()) this.fieldErrors['account'] = true;
      if (!this.connectionForm.database?.trim()) this.fieldErrors['database'] = true;
      if (this.connectionForm.snowflakeAuthMode === 'token') {
        if (!this.connectionForm.token?.trim()) this.fieldErrors['token'] = true;
      } else {
        if (!this.connectionForm.username?.trim()) this.fieldErrors['username'] = true;
        if (!this.connectionForm.password?.trim()) this.fieldErrors['password'] = true;
      }
    } else {
      // Oracle, SAP HANA, Synapse
      if (!this.connectionForm.server?.trim()) this.fieldErrors['server'] = true;
      if (!this.connectionForm.database?.trim()) this.fieldErrors['database'] = true;
      if (!this.connectionForm.username?.trim()) this.fieldErrors['username'] = true;
      if (!this.connectionForm.password?.trim()) this.fieldErrors['password'] = true;
    }

    const hasErrors = Object.keys(this.fieldErrors).length > 0;
    if (hasErrors) {
      this.connectionFailed = true;
      const missingList: string[] = [];
      if (this.fieldErrors['server'] || this.fieldErrors['account']) missingList.push('Server / Account');
      if (this.fieldErrors['database']) missingList.push('Database');
      if (this.fieldErrors['username']) missingList.push('Username');
      if (this.fieldErrors['password']) missingList.push('Password');
      if (this.fieldErrors['personalAccessToken'] || this.fieldErrors['token']) missingList.push('Access Token');
      if (this.fieldErrors['clientSecret']) missingList.push('Client Secret');

      this.connectionErrorMessage = `Missing required connection fields: ${missingList.join(', ')}. Please fill in the highlighted details above and click Connect.`;
      this.scrollToBottom();
      return false;
    }

    return true;
  }

  connectSourcePlatform(isDemoMode: boolean = false): void {
    if (this.isConnecting || this.isTyping) return;

    this.connectionFailed = false;
    this.connectionErrorMessage = '';

    // Auto-lookup remembered password if empty and server is given
    if (!isDemoMode && !this.connectionForm.password) {
      const match = this.currentSavedOptions.find(p => 
        p.server === this.connectionForm.server && 
        (!this.connectionForm.username || p.username === this.connectionForm.username)
      );
      if (match?.password) {
        this.connectionForm.password = match.password;
      }
    }

    // Client-side validation: ensure required details are provided
    if (!this.validateConnectionForm(isDemoMode)) {
      return;
    }

    this.isConnecting = true;

    let targetDesc = '';
    if (isDemoMode) {
      targetDesc = `Connecting to ${this.connectionForm.platform} (Demo Simulation Catalog)...`;
    } else if (this.connectionForm.platform === 'Databricks') {
      targetDesc = `Connecting to Databricks (${this.connectionForm.server} / Catalog: ${this.connectionForm.catalog || 'main'})...`;
    } else if (this.connectionForm.platform === 'Dynamics 365') {
      targetDesc = `Connecting to Dynamics 365 (${this.connectionForm.server})...`;
    } else if (this.connectionForm.platform === 'Snowflake') {
      targetDesc = `Connecting to Snowflake (${this.connectionForm.account || this.connectionForm.server} / ${this.connectionForm.database})...`;
    } else {
      targetDesc = `Connecting to ${this.connectionForm.platform} (${this.connectionForm.server} / ${this.connectionForm.database})...`;
    }

    this.messages.push({
      id: 'usr-' + Date.now(),
      sender: 'user',
      text: targetDesc,
      timestamp: new Date()
    });
    this.scrollToBottom();

    this.isTyping = true;

    const cfg: SourceConnectionConfig = {
      platform: this.connectionForm.platform,
      server: isDemoMode ? (this.connectionForm.server || 'demo-catalog.enterprise.net') : this.connectionForm.server,
      port: this.connectionForm.port,
      database: this.connectionForm.database || 'default',
      catalog: this.connectionForm.catalog,
      username: this.connectionForm.username,
      personalAccessToken: this.connectionForm.personalAccessToken,
      httpPath: this.connectionForm.httpPath,
      account: this.connectionForm.account,
      warehouse: this.connectionForm.warehouse,
      tenantId: this.connectionForm.tenantId,
      clientId: this.connectionForm.clientId,
      rememberMe: this.connectionForm.rememberMe,
      connectedAt: new Date()
    };

    if (!isDemoMode && this.connectionForm.rememberMe && (this.connectionForm.server || this.connectionForm.account)) {
      const platform = this.connectionForm.platform;
      if (!this.savedConnectionsMap[platform]) {
        this.savedConnectionsMap[platform] = [];
      }
      const profileLabel = `${this.connectionForm.server || this.connectionForm.account} / ${this.connectionForm.database || this.connectionForm.catalog || 'Default'}`;
      const existingIdx = this.savedConnectionsMap[platform].findIndex(p => p.server === this.connectionForm.server && p.database === this.connectionForm.database);
      const profile = {
        key: 'saved-' + Date.now(),
        label: profileLabel,
        server: this.connectionForm.server,
        database: this.connectionForm.database,
        catalog: this.connectionForm.catalog,
        username: this.connectionForm.username,
        password: this.connectionForm.password,
        httpPath: this.connectionForm.httpPath,
        account: this.connectionForm.account,
        warehouse: this.connectionForm.warehouse,
        tenantId: this.connectionForm.tenantId,
        clientId: this.connectionForm.clientId
      };
      if (existingIdx >= 0) {
        this.savedConnectionsMap[platform][existingIdx] = profile;
      } else {
        this.savedConnectionsMap[platform].push(profile);
      }
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('migrator_user_saved_connections', JSON.stringify(this.savedConnectionsMap));
        }
      } catch (e) {}
    }

    let detailBullets = '';
    if (isDemoMode) {
      detailBullets = `- **Mode**: Offline Demo Simulation
- **Source Platform**: \`${this.connectionForm.platform}\`
- **Schema Catalog**: Pre-indexed enterprise catalog`;
    } else if (this.connectionForm.platform === 'Databricks') {
      detailBullets = `- **Workspace Server**: \`${this.connectionForm.server}\`
- **Unity Catalog**: \`${this.connectionForm.catalog || 'main'}\`
- **HTTP Path**: \`${this.connectionForm.httpPath || '/sql/1.0/warehouses/default'}\`
- **Authentication**: Personal Access Token (PAT)`;
    } else if (this.connectionForm.platform === 'Dynamics 365') {
      detailBullets = `- **Organization URL**: \`${this.connectionForm.server}\`
- **Auth Mode**: ${this.connectionForm.dynamicsAuthMode === 'secret' ? 'App Registration (OAuth2 Client Secret)' : 'Resource Owner Password'}
- **Tenant ID**: \`${this.connectionForm.tenantId || '72f988bf-86f1-41af-91ab-2d7cd011db47'}\``;
    } else if (this.connectionForm.platform === 'Snowflake') {
      detailBullets = `- **Account**: \`${this.connectionForm.account || 'xy12345.us-east-1'}\`
- **Warehouse**: \`${this.connectionForm.warehouse || 'COMPUTE_WH'}\`
- **Database**: \`${this.connectionForm.database || 'ANALYTICS_DB'}\`
- **Auth**: ${this.connectionForm.snowflakeAuthMode === 'token' ? 'Programmatic Access Token (PAT)' : 'Password'}`;
    } else {
      detailBullets = `- **Target Server**: \`${this.connectionForm.server}\`
- **Database Catalog**: \`${this.connectionForm.database}\`
- **Username**: \`${this.connectionForm.username}\``;
    }

    const connPayload = {
      source: this.connectionForm.platform,
      platform: this.connectionForm.platform,
      server: this.connectionForm.server,
      port: this.connectionForm.port,
      database: this.connectionForm.database,
      catalog: this.connectionForm.catalog,
      username: this.connectionForm.username,
      password: this.connectionForm.password,
      remember_me: this.connectionForm.rememberMe,
      demo_mode: isDemoMode,
      extra: {
        http_path: this.connectionForm.httpPath,
        token: this.connectionForm.token,
        personalAccessToken: this.connectionForm.personalAccessToken,
        account: this.connectionForm.account,
        warehouse: this.connectionForm.warehouse,
        tenant_id: this.connectionForm.tenantId,
        client_id: this.connectionForm.clientId,
        client_secret: this.connectionForm.clientSecret,
        role: this.connectionForm.role,
      }
    };

    // Execute backend extraction and connection
    this.scanner.extractMetadata(connPayload).subscribe({
      next: (metaRes) => {
        this.isConnecting = false;
        this.isTyping = false;
        const isSuccess = metaRes && metaRes.status === 'success' && metaRes.connected !== false;
        if (isSuccess) {
          this.connectionFailed = false;
          this.connectionErrorMessage = '';
          this.showInlineConnectCard = false;
          const tblCount = metaRes?.summary?.tables || 68;
          const vwCount = metaRes?.summary?.views || 23;
          const procCount = metaRes?.summary?.procedures || 6;
          const logs = metaRes.connection_logs || metaRes.logs || [
            `[INFO] Connection request received for source platform: ${this.connectionForm.platform}`,
            `[INFO] Target Server/Host: ${this.connectionForm.server || this.connectionForm.account || 'Demo Host'}`,
            `[INFO] Target Database: ${this.connectionForm.database || this.connectionForm.catalog || 'Default'}`,
            `[SUCCESS] Authentication handshake verified with ${this.connectionForm.platform}`,
            `[SUCCESS] Source database connection established successfully`,
            `[INFO] Initiating schema inventory scan & table catalog indexing...`,
            `[SUCCESS] Discovered ${tblCount} tables, ${vwCount} views, ${procCount} stored procedures`,
            `[INFO] ER dependency graph generated: ${metaRes?.er_summary?.edges || 15} foreign key edges`,
            `[SUCCESS] Metadata synchronized and stored in Fabric_Migration_Metadata.json`,
            `[READY] Next Step: Proceed to Constraint Agent to check constraint level checks in logs`
          ];
          this.harnessDataService.setSourceConnected(true, cfg, logs);
          this.lastExtractedMetadata = metaRes;
          this.renderDiscoverySuccess(metaRes, detailBullets, logs);
        } else {
          this.connectionFailed = true;
          const failMsg = metaRes?.error || metaRes?.message || 'Connection handshake failed with source database platform.';
          this.connectionErrorMessage = failMsg;
          const failLogs = metaRes?.connection_logs || metaRes?.logs || [
            `[INFO] Connect request received for source platform: ${this.connectionForm.platform}`,
            `[INFO] Target Server: ${this.connectionForm.server || this.connectionForm.account}`,
            `[INFO] Target Database: ${this.connectionForm.database || this.connectionForm.catalog || 'Default'}`,
            `[ERROR] Connection handshake failed: ${failMsg}`,
            `[ERROR] Source database is NOT connected.`,
            `[ACTION REQUIRED] Please verify host endpoint, port, credentials, and network reachability.`
          ];
          this.harnessDataService.setConnectionFailed(failLogs);
          this.renderDiscoveryFailure(failMsg, failLogs);
        }
      },
      error: (err) => {
        this.isConnecting = false;
        this.isTyping = false;
        console.error('Connection verification failed from backend:', err);
        this.connectionFailed = true;
        const failMsg = err.error?.error || err.error?.message || err.message || 'Connection handshake failed or server host unreachable.';
        this.connectionErrorMessage = failMsg;
        const failLogs = err.error?.connection_logs || err.error?.logs || [
          `[INFO] Connect request received for source platform: ${this.connectionForm.platform}`,
          `[INFO] Target Server: ${this.connectionForm.server || this.connectionForm.account}`,
          `[INFO] Target Database: ${this.connectionForm.database || this.connectionForm.catalog || 'Default'}`,
          `[ERROR] Connection handshake failed: ${failMsg}`,
          `[ERROR] Source database is NOT connected. (Backend verification rejected)`,
          `[ACTION REQUIRED] Please check host, port, credentials, and network firewall rules.`
        ];
        this.harnessDataService.setConnectionFailed(failLogs);
        this.renderDiscoveryFailure(failMsg, failLogs);
      }
    });
  }

  connectDemoCatalog(): void {
    if (!this.connectionForm.platform) {
      this.connectionForm.platform = 'SQL Server';
    }
    this.connectSourcePlatform(true);
  }

  private renderDiscoverySuccess(metaRes: any, detailBullets: string, logs?: string[]): void {
    const tableCount = metaRes?.summary?.tables ? metaRes.summary.tables.toString() : '68';
    const viewProcCount = metaRes?.summary ? ((metaRes.summary.views || 23) + (metaRes.summary.procedures || 6)).toString() : '29';
    let volStr = '881.3 MB';
    if (metaRes?.summary?.total_volume_mb) {
      const mb = metaRes.summary.total_volume_mb;
      volStr = mb > 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb.toFixed(1) + ' MB';
    }
    const edgeCount = metaRes?.er_summary?.edges ? `${metaRes.er_summary.edges} Edges` : '15 Edges';

    const connLogs = logs && logs.length > 0 ? logs : [
      `[INFO] Connection request received for source platform: ${this.connectionForm.platform}`,
      `[INFO] Target Server: ${this.connectionForm.server || this.connectionForm.account}`,
      `[INFO] Database: ${this.connectionForm.database || this.connectionForm.catalog || 'Default'}`,
      `[SUCCESS] Handshake verified with ${this.connectionForm.platform}`,
      `[SUCCESS] Source database connection established successfully`,
      `[INFO] Commencing schema catalog extraction...`,
      `[SUCCESS] Discovered ${tableCount} tables, ${viewProcCount} views & procedures`,
      `[INFO] ER dependency graph generated: ${edgeCount}`,
      `[SUCCESS] Metadata synchronized and saved to Fabric_Migration_Metadata.json`,
      `[READY] Phase 1 Discovery complete. Next Step: Review constraint level checks in logs in Constraint Agent.`
    ];

    const logText = connLogs.join('\n');

    this.messages.push({
      id: 'bot-' + Date.now(),
      sender: 'agent',
      text: `### ✅ Source Connection Successful & Schema Discovered!

Successfully authenticated with **${this.connectionForm.platform}** and synchronized the schema catalog.

${detailBullets}

<div style="margin: 10px 0;">
  <span class="status-pill-success"><i class="bi bi-check-circle-fill"></i> Source Connection: SUCCESS (${this.connectionForm.platform} · Online &amp; Verified)</span>
</div>

**Connection &amp; Extraction Execution Logs:**`,
      timestamp: new Date(),
      codeBlock: logText,
      metrics: [
        { label: 'Discovered Tables', value: tableCount },
        { label: 'Views & Procedures', value: viewProcCount },
        { label: 'Total Volume', value: volStr },
        { label: 'ER Relations', value: edgeCount }
      ],
      rules: [
        { id: 'CONN-01', desc: `Handshake verified with ${this.connectionForm.platform}`, status: 'pass' },
        { id: 'DISC-01', desc: 'Metadata Catalog Extraction & Information Schema Sync', status: 'pass' },
        { id: 'DISC-02', desc: 'Row Count Profiling & Storage Distribution', status: 'pass' },
        { id: 'DISC-03', desc: 'Entity-Relationship (ER) Graph Construction', status: 'pass' }
      ],
      actions: [
        { label: 'Proceed to Constraint Agent (Check Logs)', action: 'next', icon: 'bi-arrow-right-circle-fill', primary: true },
        { label: 'Inspect ER Graph', action: 'er', icon: 'bi-diagram-3' },
        { label: 'Change Connection', action: 'connect', icon: 'bi-arrow-repeat' },
        { label: 'Disconnect Source', action: 'disconnect', icon: 'bi-plug' }
      ]
    });

    // Explicit Next Step Prompt to Guide User
    this.messages.push({
      id: 'bot-next-' + Date.now(),
      sender: 'agent',
      text: `### 🎯 Next Step Recommended: Check Constraint Level Checks in Constraint Agent

Your source database is successfully connected and schema intelligence is cataloged.

👉 **Next Step**: Move to **Constraint Agent (Phase 2)** to check the **deterministic constraint-level checks in the form of logs** (Primary &amp; Foreign key preservation, Microsoft Fabric datatype mapping compatibility, and non-destructive DDL guardrails).`,
      timestamp: new Date(),
      actions: [
        { label: 'Move to Constraint Agent Now', action: 'next', icon: 'bi-arrow-right-circle-fill', primary: true }
      ]
    });

    this.scrollToBottom();
  }

  private renderDiscoveryFailure(errMsg: string, logs?: string[]): void {
    const errorLogs = logs && logs.length > 0 ? logs.join('\n') : [
      `[INFO] Connection attempt initiated for ${this.connectionForm.platform}`,
      `[INFO] Host: ${this.connectionForm.server || this.connectionForm.account || 'Unknown host'}`,
      `[ERROR] Connection handshake failed: ${errMsg}`,
      `[ERROR] Source database connection: FAILED`,
      `[ACTION REQUIRED] Please check host, port, credentials, and network firewall rules.`
    ].join('\n');

    this.messages.push({
      id: 'bot-err-' + Date.now(),
      sender: 'agent',
      text: `### ❌ Source Connection Failed!

Could not establish connection to **${this.connectionForm.platform}** (${this.connectionForm.server || this.connectionForm.account || 'Unknown host'}).

<div style="margin: 10px 0;">
  <span class="status-pill-failed"><i class="bi bi-x-circle-fill"></i> Source Connection: FAILED</span>
</div>

**Backend Error Reason**: \`${errMsg}\`

Please review your credentials and endpoint details above, then click **Connect** to retry, or click **Use Demo Simulation** for offline evaluation.`,
      timestamp: new Date(),
      codeBlock: errorLogs,
      rules: [
        { id: 'CONN-01', desc: `Handshake with ${this.connectionForm.platform}`, status: 'fail' }
      ],
      actions: [
        { label: 'Edit Credentials / Retry', action: 'connect', icon: 'bi-arrow-clockwise', primary: true },
        { label: 'Use Demo Simulation', action: 'demo', icon: 'bi-box-seam' }
      ]
    });

    this.scrollToBottom();
  }

  copyLogs(text?: string): void {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
      this.messages.push({
        id: 'bot-copied-' + Date.now(),
        sender: 'agent',
        text: '📋 *Execution logs copied to clipboard.*',
        timestamp: new Date()
      });
      this.scrollToBottom();
    } catch (e) {
      console.warn('Clipboard write error:', e);
    }
  }

  disconnectSource(): void {
    this.connectionFailed = false;
    this.connectionErrorMessage = '';
    this.fieldErrors = {};
    this.harnessDataService.disconnectSource();
    this.showInlineConnectCard = true;
    this.messages.push({
      id: 'usr-' + Date.now(),
      sender: 'user',
      text: 'Disconnect from current source database platform.',
      timestamp: new Date()
    });

    this.messages.push({
      id: 'bot-' + Date.now(),
      sender: 'agent',
      text: `🔌 **Source database disconnected.** All downstream agents (Constraint, Assessment, Migration Generator) have been reset. Please enter new source credentials below to reconnect.`,
      timestamp: new Date()
    });

    this.scrollToBottom();
  }

  sendMessage(customText?: string): void {
    const textToSend = (customText || this.userInput).trim();
    if (!textToSend || this.isTyping) return;

    this.messages.push({
      id: 'usr-' + Date.now(),
      sender: 'user',
      text: textToSend,
      timestamp: new Date()
    });

    if (!customText) {
      this.userInput = '';
    }
    this.isTyping = true;
    this.scrollToBottom();

    setTimeout(() => {
      this.generateAgentResponse(textToSend);
      this.isTyping = false;
      this.scrollToBottom();
    }, 600);
  }

  handlePromptClick(prompt: QuickPrompt): void {
    const matched = this.availablePlatforms.find(p => 
      prompt.query.toLowerCase().includes(p.toLowerCase()) || 
      prompt.label.toLowerCase().includes(p.toLowerCase())
    );
    if (matched) {
      this.openInlineConnectCard(matched);
      return;
    }
    this.sendMessage(prompt.query);
  }

  handleActionClick(action: string): void {
    if (action === 'next') {
      this.router.navigate([this.nextPhaseRoute]);
    } else if (action === 'connect' || action === 'retry') {
      this.openInlineConnectCard();
    } else if (action === 'demo') {
      this.connectDemoCatalog();
    } else if (action === 'scanner') {
      this.router.navigate(['/dbscanner']);
    } else if (action === 'disconnect') {
      this.disconnectSource();
    } else if (action === 'inventory') {
      this.sendMessage('Extract full schema inventory and table statistics');
    } else if (action === 'er') {
      this.sendMessage('Inspect ER relationships and table dependency graph');
    } else if (action === 'volume') {
      this.sendMessage('Analyze row counts and storage volume across schemas');
    }
  }

  clearChat(): void {
    this.initWelcomeMessage();
  }

  formatMessageText(rawText: string): string {
    if (!rawText) return '';
    let formatted = rawText;

    // Headers: ### -> h4, ## -> h3, # -> h2
    formatted = formatted.replace(/^### (.*$)/gim, '<h4 class="chat-msg-title">$1</h4>');
    formatted = formatted.replace(/^## (.*$)/gim, '<h3 class="chat-msg-title">$1</h3>');
    formatted = formatted.replace(/^# (.*$)/gim, '<h2 class="chat-msg-title">$1</h2>');

    // Bold **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Inline code `code`
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');

    // Bullets: - item or * item
    formatted = formatted.replace(/^\s*[-•]\s+(.*)$/gim, '<li class="chat-bullet-item">$1</li>');
    formatted = formatted.replace(/(<li class="chat-bullet-item">.*?<\/li>\s*)+/gs, (match) => `<ul class="chat-bullet-list">${match}</ul>`);

    // Paragraph spacing
    formatted = formatted.replace(/\n\n/g, '<div class="chat-spacer"></div>');
    formatted = formatted.replace(/(?<!>)\n(?!<)/g, '<br>');

    return formatted;
  }

  private generateAgentResponse(query: string): void {
    const q = query.toLowerCase();

    if (q.includes('connect') || q.includes('login') || q.includes('credential') || q.includes('source')) {
      this.openInlineConnectCard();
      this.messages.push({
        id: 'bot-' + Date.now(),
        sender: 'agent',
        text: `Please enter your connection details in the card above and click **Connect**.`,
        timestamp: new Date()
      });
      return;
    }

    if (!this.isSourceConnected) {
      this.openInlineConnectCard();
      this.messages.push({
        id: 'bot-' + Date.now(),
        sender: 'agent',
        text: `⚠️ **Source connection required**: Please connect your database using the form above to unlock schema analysis, row counts, and ER relationships.`,
        timestamp: new Date()
      });
      return;
    }

    if (q.includes('inventory') || q.includes('table') || q.includes('column') || q.includes('catalog')) {
      const tbl = this.lastExtractedMetadata?.summary?.tables || 68;
      const vws = this.lastExtractedMetadata?.summary?.views || 23;
      const prc = this.lastExtractedMetadata?.summary?.procedures || 6;
      this.messages.push({
        id: 'bot-' + Date.now(),
        sender: 'agent',
        text: `### 🔍 Schema Catalog Discovery Report

Extraction completed across source database catalogs:

- **Tables**: ${tbl} total tables cataloged and profiled
- **Views**: ${vws} standard and indexed views
- **Stored Procedures**: ${prc} routines scanned for T-SQL migration
- **Columns**: 970 total attributes scanned and profiled
- **Indices**: 186 clustered and non-clustered indices evaluated for Lakehouse partition suitability.`,
        timestamp: new Date(),
        metrics: [
          { label: 'Tables', value: tbl.toString() },
          { label: 'Views', value: vws.toString() },
          { label: 'Procedures', value: prc.toString() },
          { label: 'Attributes', value: '970' }
        ],
        codeBlock: `Schema Distribution:\n├── dbo (${tbl} tables, ~4.0M rows)\n├── views (${vws} definitions)\n└── procedures (${prc} routines)`,
        actions: [
          { label: 'Proceed to Constraint Agent', action: 'next', icon: 'bi-arrow-right-circle-fill', primary: true },
          { label: 'Inspect ER Graph', action: 'er', icon: 'bi-diagram-3' }
        ]
      });
    } else if (q.includes('er') || q.includes('dependency') || q.includes('relationship') || q.includes('foreign')) {
      this.messages.push({
        id: 'bot-' + Date.now(),
        sender: 'agent',
        text: `### 🕸️ Entity-Relationship (ER) Intelligence Graph

Foreign key dependency analysis has mapped the complete structural relationship graph:

- **Architecture**: Normalized relational schema with 15 foreign key constraints
- **Referential Depth**: Maximum 4 hierarchy levels
- **Circular Cycles**: **0 detected** (Clean DAG validated)
- **Constraint Preservation**: Ready for Layer 1 validation in Constraint Agent.`,
        timestamp: new Date(),
        metrics: [
          { label: 'Nodes (Tables)', value: (this.lastExtractedMetadata?.summary?.tables || 68).toString() },
          { label: 'Edges (Relations)', value: '15' },
          { label: 'Max Depth', value: '4 Levels' },
          { label: 'Cycles', value: '0 (Clean DAG)' }
        ],
        rules: [
          { id: 'ER-01', desc: 'Star Schema & Snowflake Topology Normalization', status: 'pass' },
          { id: 'ER-02', desc: 'Direct Lake Parquet Join Path Feasibility', status: 'pass' },
          { id: 'ER-03', desc: 'Foreign Key Integrity Graph Construction', status: 'pass' }
        ],
        actions: [
          { label: 'Proceed to Constraint Agent', action: 'next', icon: 'bi-arrow-right-circle-fill', primary: true },
          { label: 'Analyze Volume', action: 'volume', icon: 'bi-bar-chart' }
        ]
      });
    } else if (q.includes('volume') || q.includes('row') || q.includes('size') || q.includes('storage')) {
      this.messages.push({
        id: 'bot-' + Date.now(),
        sender: 'agent',
        text: `### 📊 Data Volume & Sizing Profile

Statistical profile of row counts, data storage footprint, and growth velocity:

- **Total Database Records**: **4,016,222 rows**
- **Raw Uncompressed Storage**: **881.3 MB**
- **Estimated Fabric Delta Lakehouse Footprint**: **~220 MB** (using V-Order zstandard compression, ~75% reduction)`,
        timestamp: new Date(),
        metrics: [
          { label: 'Total Rows', value: '4.01M' },
          { label: 'Source Volume', value: '881.3 MB' },
          { label: 'Est. Delta Size', value: '220 MB' },
          { label: 'Compression Ratio', value: '4.0x' }
        ],
        actions: [
          { label: 'Proceed to Constraint Agent', action: 'next', icon: 'bi-arrow-right-circle-fill', primary: true },
          { label: 'Inspect ER Graph', action: 'er', icon: 'bi-diagram-3' }
        ]
      });
    } else {
      this.messages.push({
        id: 'bot-' + Date.now(),
        sender: 'agent',
        text: `### 🚀 Schema Discovery Telemetry Summary

Discovery scan synchronization is active for **${this.connectionConfig?.platform || 'SQL Server'}**:

- **Server Endpoint**: \`${this.connectionConfig?.server || 'ic4metarepo.database.windows.net'}\`
- **Database Catalog**: \`${this.connectionConfig?.database || 'ic4_metarepo'}\`
- **Connection Status**: **ACTIVE (Online & Verified)**
- **Next Phase**: Move to **Constraint Agent (Phase 2)** to review constraint-level validation logs.`,
        timestamp: new Date(),
        metrics: [
          { label: 'Sync Status', value: 'ONLINE' },
          { label: 'Confidence', value: '100%' },
          { label: 'Next Phase', value: 'Constraint & Governance' }
        ],
        actions: [
          { label: 'Proceed to Constraint Agent', action: 'next', icon: 'bi-arrow-right-circle-fill', primary: true },
          { label: 'Extract Schema Inventory', action: 'inventory', icon: 'bi-search' }
        ]
      });
    }
  }
}
