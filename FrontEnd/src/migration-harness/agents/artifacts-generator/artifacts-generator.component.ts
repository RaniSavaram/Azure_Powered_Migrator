import { AfterViewChecked, Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';
import { Scanner, FabricConnectionDetails } from '../../../app/services/scanner/scanner';

import {
  emptyFabricDestinationForm,
  validateFabricDestination,
  trimFabricDestination,
  buildFabricSummaryRows
} from '../../utils/fabric-destination.util';

type DestinationType = 'Microsoft Fabric';
type ArtifactsAction = 'use-saved' | 'new-destination' | 'change-destination' | 'go-scan' | 'go-discovery' | 'generate';

export interface ArtifactsChatAction {
  label: string;
  icon: string;
  action: ArtifactsAction;
  primary?: boolean;
}

/** One Delta table created in the Lakehouse. */
export interface DeploymentTable {
  schema: string;
  table: string;
  columns: number;
  uri: string;
  layer: string;
}

/** Normalised view of a generate-fabric-artifacts response. */
export interface DeploymentResult {
  status: string;
  message: string;
  lakehouseName: string;
  tables: DeploymentTable[];
  errors: string[];
  logs: string[];
  volumes: string[];
  warehouseName: string;
  warehouseObjects: string[];
  pipelineName: string;
  pipelineActivities: number;
  pipelineError: string;
}

export interface ArtifactsChatMessage {
  id: number;
  sender: 'agent' | 'user';
  text: string;
  timestamp: Date;
  /** Label/value rows, e.g. the destination summary after a successful connect. */
  details?: Array<{ label: string; value: string }>;
  /** Interactive results panel for a completed deployment. */
  deployment?: DeploymentResult;
  actions?: ArtifactsChatAction[];
}

interface QuickPrompt {
  label: string;
  icon: string;
  query: string;
}

/**
 * Artifacts Generator conversation. Asks which destination the generated
 * artifacts go to (only Microsoft Fabric for now) through an inline card in
 * the chat, collects and validates the connection details through Django's
 * connect_fabric view, and stores them as the Scanner's fabricDestination -
 * which Generate Artifacts deploys into once a scan completes.
 */
import { ResultsDialogComponent } from '../../components/results-dialog/results-dialog.component';

@Component({
  selector: 'app-artifacts-generator',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ResultsDialogComponent],
  templateUrl: './artifacts-generator.component.html',
  styleUrl: './artifacts-generator.component.css'
})
export class ArtifactsGeneratorComponent implements AfterViewChecked {
  private harnessDataService = inject(HarnessDataService);
  private scanner = inject(Scanner);
  private router = inject(Router);

  showResultsDialog = signal(false);

  openResultsDialog(): void {
    this.showResultsDialog.set(true);
  }

  closeResultsDialog(): void {
    this.showResultsDialog.set(false);
  }

  @ViewChild('chatScroll') private chatScroll?: ElementRef<HTMLElement>;

  agentName = 'Artifacts Generator';
  phase = 'Phase 5 · OneLake Delta Tables & Reports';
  nextPhaseRoute = '/';
  nextPhaseName = 'Dashboard';

  readonly availableDestinations: DestinationType[] = ['Microsoft Fabric'];

  readonly quickPrompts: QuickPrompt[] = [
    { label: 'Generate artifacts', icon: 'bi-box-seam', query: 'Generate the artifacts now' },
    { label: 'Current destination', icon: 'bi-geo-alt', query: 'Show my current destination' },
    { label: 'What gets deployed?', icon: 'bi-info-circle', query: 'What gets deployed?' },
    { label: 'Change destination', icon: 'bi-arrow-left-right', query: 'Change destination' }
  ];

  messages = signal<ArtifactsChatMessage[]>([]);
  isTyping = signal(false);
  showDestinationCard = signal(false);
  connectionError = signal<string | null>(null);
  fieldErrors = signal<Record<string, boolean>>({});
  destination = this.scanner.fabricDestination;

  selectedDestination: DestinationType | '' = '';
  form: FabricConnectionDetails = emptyFabricDestinationForm();
  rememberMe = true;
  showAdvanced = false;
  showSecret = false;
  userInput = '';

  toggleSecret(): void {
    if (!this.form.clientSecret || !this.form.clientSecret.trim()) {
      this.showSecret = false;
      return;
    }
    this.showSecret = !this.showSecret;
  }

  isSecretVisible(): boolean {
    return this.showSecret && !!this.form.clientSecret?.trim();
  }

  /** Results-panel state: table search, which sections are open, copy feedback. */
  tableFilter = signal('');
  openSections = signal<Record<string, boolean>>({ tables: true, errors: true, logs: false });
  copiedKey = signal<string | null>(null);

  private nextId = 1;
  private shouldScroll = false;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  toggleSection(key: string): void {
    this.openSections.update(open => ({ ...open, [key]: !open[key] }));
  }

  isSectionOpen(key: string): boolean {
    return !!this.openSections()[key];
  }

  /** Case-insensitive match on schema, table or layer. */
  filteredTables(d: DeploymentResult): DeploymentTable[] {
    const q = this.tableFilter().trim().toLowerCase();
    if (!q) return d.tables;
    return d.tables.filter(t =>
      `${t.schema}.${t.table}`.toLowerCase().includes(q) || (t.layer || '').toLowerCase().includes(q)
    );
  }

  totalColumns(d: DeploymentResult): number {
    return d.tables.reduce((sum, t) => sum + (t.columns || 0), 0);
  }

  /**
   * Status is never carried by colour alone - every badge pairs the colour
   * with an icon and a text label.
   */
  statusMeta(status: string): { label: string; icon: string; tone: string } {
    if (status === 'success') return { label: 'Deployed', icon: 'bi-check-circle-fill', tone: 'good' };
    if (status === 'partial') return { label: 'Partial', icon: 'bi-exclamation-triangle-fill', tone: 'warn' };
    return { label: 'Failed', icon: 'bi-x-octagon-fill', tone: 'bad' };
  }

  copyText(text: string, key: string): void {
    navigator.clipboard?.writeText(text).then(() => {
      this.copiedKey.set(key);
      if (this.copyTimer) clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => this.copiedKey.set(null), 1600);
    });
  }

  copyLogs(d: DeploymentResult): void {
    this.copyText(d.logs.join(String.fromCharCode(10)), 'logs');
  }

  constructor() {
    this.startConversation();
  }

  get isSourceConnected(): boolean {
    return this.harnessDataService.isSourceConnected();
  }

  get isServicePrincipal(): boolean {
    return (this.form.authMode || 'servicePrincipal') === 'servicePrincipal';
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.shouldScroll = false;
      const el = this.chatScroll?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }

  // ---------------------------------------------------------------------------
  // Conversation flow
  // ---------------------------------------------------------------------------

  startConversation(): void {
    this.messages.set([]);
    this.connectionError.set(null);
    this.fieldErrors.set({});
    this.showDestinationCard.set(false);

    const configured = this.scanner.getFabricDestination();
    const wsName = this.harnessDataService.getDestinationWorkspaceName() || undefined;
    if (configured) {
      this.agentSays(
        "Hi, I'm the Artifacts Generator. Using the migration destination configured in Discovery Agent, I am ready to deploy your Delta tables, Data Factory pipelines, views, and stored procedures.",
        { details: this.summaryRows(configured, wsName) }
      );
      this.agentSays(
        'Click Generate artifacts now to provision items into this Microsoft Fabric workspace.',
        {
          actions: [
            { label: 'Generate artifacts now', icon: 'bi-box-seam', action: 'generate', primary: true },
            { label: 'Open scanner page', icon: 'bi-database', action: 'go-scan' },
            { label: 'Change destination', icon: 'bi-pencil', action: 'change-destination' }
          ]
        }
      );
    } else {
      this.agentSays(
        "Hi, I'm the Artifacts Generator. No destination has been configured in Discovery Agent (Phase 1) yet. Return to Discovery Agent to set your target workspace, or configure it below.",
        {
          actions: [
            { label: 'Open Discovery Agent', icon: 'bi-search', action: 'go-discovery', primary: true },
            { label: 'Configure destination here', icon: 'bi-cloud-upload', action: 'new-destination' }
          ]
        }
      );
    }
  }

  handleActionClick(action: ArtifactsAction): void {
    switch (action) {
      case 'use-saved': {
        const saved = this.scanner.getFabricDestination();
        if (!saved) return this.openDestinationCard();
        this.userSays('Use saved destination');
        this.confirmDestination('Using your saved Microsoft Fabric destination.', saved);
        break;
      }
      case 'new-destination':
      case 'change-destination':
        this.userSays(action === 'new-destination' ? 'Enter new details' : 'Change destination');
        this.openDestinationCard();
        break;
      case 'generate':
        this.userSays('Generate artifacts now');
        this.runGeneration();
        break;
      case 'go-scan':
        this.router.navigate(['/dbscanner']);
        break;
      case 'go-discovery':
        this.router.navigate(['/agents/discovery']);
        break;
    }
  }

  /**
   * Deploys the artifacts straight from this conversation rather than sending
   * the user to the scanner page. Generation reuses the metadata from the last
   * completed scan, so pipeline state is checked first and the scanner page is
   * only offered when there is nothing to deploy yet.
   */
  runGeneration(): void {
    if (this.isTyping()) return;

    const destination = this.scanner.getFabricDestination();
    if (!destination) {
      this.agentSays('Choose a destination first, then I can create the artifacts in it.');
      this.openDestinationCard();
      return;
    }

    this.isTyping.set(true);
    this.scanner.getPipelineState().subscribe({
      next: (state) => {
        if (!state.has_metadata) {
          this.isTyping.set(false);
          this.agentSays(
            'There is no scanned metadata to deploy yet. Run a database scan first, then come back and I will create the artifacts here.',
            { actions: [{ label: 'Open scanner page', icon: 'bi-database', action: 'go-scan', primary: true }] }
          );
          return;
        }
        this.deployArtifacts(state.platform_slug, destination);
      },
      // Pipeline state is only a pre-check - let the backend decide the source.
      error: () => this.deployArtifacts('', destination)
    });
  }

  private deployArtifacts(sourceSlug: string, destination: FabricConnectionDetails): void {
    this.agentSays('Creating the artifacts in Microsoft Fabric. This can take a few minutes...');
    this.scanner.generateFabricArtifacts(sourceSlug || undefined, undefined, destination).subscribe({
      next: (res) => {
        this.isTyping.set(false);
        if (res.status === 'error') {
          this.agentSays(res.message || 'The artifacts could not be created.', { actions: this.retryActions() });
          return;
        }
        this.agentSays(res.message || 'Artifacts created in Microsoft Fabric.', {
          deployment: this.toDeployment(res)
        });
      },
      error: (err) => {
        this.isTyping.set(false);
        this.agentSays(
          err.error?.message || err.message || 'Could not reach the artifacts generator.',
          { actions: this.retryActions() }
        );
      }
    });
  }

  private retryActions(): ArtifactsChatAction[] {
    return [
      { label: 'Try again', icon: 'bi-arrow-clockwise', action: 'generate', primary: true },
      { label: 'Open scanner page', icon: 'bi-database', action: 'go-scan' }
    ];
  }

  /**
   * Flattens the generator response into the shape the results panel renders.
   * Prefers `processed` (carries uri and layer) over `tables_info`.
   */
  private toDeployment(res: any): DeploymentResult {
    const rows: any[] = (res.processed?.length ? res.processed : res.tables_info) || [];
    const pipeline = res.pipeline || {};
    const warehouse = res.warehouse || {};
    return {
      status: res.status || 'success',
      message: res.message || '',
      lakehouseName: res.lakehouse_name || res.target?.report_name || '',
      tables: rows.map(r => ({
        schema: r.schema || '',
        table: r.table || '',
        columns: r.columns ?? r.columns_count ?? 0,
        uri: r.uri || '',
        layer: r.layer || 'Table'
      })),
      errors: res.errors || [],
      logs: res.logs || [],
      volumes: res.volumes?.created || [],
      warehouseName: warehouse.name || '',
      warehouseObjects: warehouse.created || [],
      pipelineName: pipeline.name || '',
      pipelineActivities: pipeline.activities || 0,
      pipelineError: pipeline.error || ''
    };
  }

  handlePromptClick(prompt: QuickPrompt): void {
    this.sendMessage(prompt.query);
  }

  /** Free-text replies: routes a few intents, and explains what the agent can do otherwise. */
  sendMessage(customText?: string): void {
    const text = (customText ?? this.userInput).trim();
    if (!text || this.isTyping()) return;
    this.userSays(text);
    this.userInput = '';

    const q = text.toLowerCase();
    const saved = this.scanner.getFabricDestination();

    if (/(change|select|choose|new|set).*(destination|target|workspace)|^destination|fabric/.test(q)) {
      this.openDestinationCard();
    } else if (/(current|show|which|my).*(destination|target|workspace)/.test(q)) {
      if (saved) {
        this.agentSays('Artifacts will be deployed here:', {
          details: this.summaryRows(saved),
          actions: [{ label: 'Change destination', icon: 'bi-pencil', action: 'change-destination' }]
        });
      } else {
        this.agentSays('No destination is configured yet.');
        this.openDestinationCard();
      }
    } else if (/(what|which).*(deploy|creat|artifact)/.test(q)) {
      this.agentSays(
        'For each scanned source I create: a Lakehouse (or use the one you specify) with one Delta table per source table, ' +
        'Files/ folders for volumes, a Data Factory pipeline, and placeholder views, stored procedures and functions in your Warehouse.'
      );
    } else if (/(scan|generate|run|how)/.test(q)) {
      this.agentSays(
        saved
          ? 'I can create the artifacts in your saved destination now, using the metadata from your last scan.'
          : 'First choose a destination below, then I can create the artifacts.',
        saved
          ? {
              actions: [
                { label: 'Generate artifacts now', icon: 'bi-box-seam', action: 'generate', primary: true },
                { label: 'Open scanner page', icon: 'bi-database', action: 'go-scan' }
              ]
            }
          : undefined
      );
      if (!saved) this.openDestinationCard();
    } else {
      this.agentSays('I can set or change your deployment destination, show the current one, or explain what gets deployed. Try one of the suggestions below.');
    }
  }

  // ---------------------------------------------------------------------------
  // Inline destination card
  // ---------------------------------------------------------------------------

  openDestinationCard(): void {
    const saved = this.scanner.getFabricDestination();
    this.selectedDestination = '';
    this.form = saved ? { ...saved } : emptyFabricDestinationForm();
    this.showAdvanced = !!(this.form.lakehouseName || this.form.warehouseName || this.form.warehouseHost);
    this.connectionError.set(null);
    this.fieldErrors.set({});
    this.agentSays('Please select your destination.');
    this.showDestinationCard.set(true);
  }

  closeDestinationCard(): void {
    if (this.isTyping()) return;
    this.showDestinationCard.set(false);
  }

  selectDestination(value: DestinationType | ''): void {
    if (value === this.selectedDestination) return;
    this.selectedDestination = value;
    this.connectionError.set(null);
    this.fieldErrors.set({});
    this.shouldScroll = true;
  }

  submitDestination(): void {
    if (!this.selectedDestination) {
      this.connectionError.set('Please select your destination.');
      return;
    }
    const problem = this.validate();
    if (problem) {
      this.connectionError.set(problem);
      return;
    }

    const details = trimFabricDestination(this.form);

    this.connectionError.set(null);
    this.isTyping.set(true);
    this.shouldScroll = true;

    this.scanner.connectFabric(details, this.rememberMe).subscribe({
      next: (res) => {
        this.isTyping.set(false);
        const destination: FabricConnectionDetails = {
          ...details,
          lakehouseName: details.lakehouseName || res.details?.lakehouse_name || '',
          warehouseName: details.warehouseName || res.details?.warehouse_name || ''
        };
        this.scanner.setFabricDestination(destination, this.rememberMe);
        this.harnessDataService.setDestinationConfirmed(true, res.details?.workspace_name || destination.workspaceId);
        this.showDestinationCard.set(false);
        this.userSays(`Connect to Microsoft Fabric workspace ${destination.workspaceId}`);
        this.confirmDestination(res.message || 'Connected to Microsoft Fabric.', destination, res.details?.workspace_name);
      },
      error: (err) => {
        this.isTyping.set(false);
        this.connectionError.set(
          err.error?.message || err.message || 'Could not connect to Microsoft Fabric. Check the IDs and credentials, then try again.'
        );
        this.shouldScroll = true;
      }
    });
  }

  private confirmDestination(text: string, d: FabricConnectionDetails, workspaceName?: string): void {
    this.agentSays(text, { details: this.summaryRows(d, workspaceName) });
    this.agentSays(
      'I can create the artifacts in this destination now, using the metadata from your last scan.',
      {
        actions: [
          { label: 'Generate artifacts now', icon: 'bi-box-seam', action: 'generate', primary: true },
          { label: 'Open scanner page', icon: 'bi-database', action: 'go-scan' },
          { label: 'Change destination', icon: 'bi-pencil', action: 'change-destination' }
        ]
      }
    );
  }

  private validate(): string | null {
    const { errors, message } = validateFabricDestination(this.form);
    this.fieldErrors.set(errors);
    return message;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  summaryRows(d: FabricConnectionDetails, workspaceName?: string): Array<{ label: string; value: string }> {
    return buildFabricSummaryRows(d, workspaceName);
  }

  private agentSays(text: string, extra?: Pick<ArtifactsChatMessage, 'details' | 'actions' | 'deployment'>): void {
    this.push({ sender: 'agent', text, ...extra });
  }

  private userSays(text: string): void {
    this.push({ sender: 'user', text });
  }

  private push(msg: Omit<ArtifactsChatMessage, 'id' | 'timestamp'>): void {
    this.messages.update(list => [...list, { ...msg, id: this.nextId++, timestamp: new Date() }]);
    this.shouldScroll = true;
  }


}
