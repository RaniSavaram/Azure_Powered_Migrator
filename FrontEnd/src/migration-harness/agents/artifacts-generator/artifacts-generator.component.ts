import { AfterViewChecked, Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';
import { Scanner, FabricConnectionDetails } from '../../../app/services/scanner/scanner';

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DestinationType = 'Microsoft Fabric';
type ArtifactsAction = 'use-saved' | 'new-destination' | 'change-destination' | 'go-scan';

export interface ArtifactsChatAction {
  label: string;
  icon: string;
  action: ArtifactsAction;
  primary?: boolean;
}

export interface ArtifactsChatMessage {
  id: number;
  sender: 'agent' | 'user';
  text: string;
  timestamp: Date;
  /** Label/value rows, e.g. the destination summary after a successful connect. */
  details?: Array<{ label: string; value: string }>;
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
@Component({
  selector: 'app-artifacts-generator',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './artifacts-generator.component.html',
  styleUrl: './artifacts-generator.component.css'
})
export class ArtifactsGeneratorComponent implements AfterViewChecked {
  private harnessDataService = inject(HarnessDataService);
  private scanner = inject(Scanner);
  private router = inject(Router);

  @ViewChild('chatScroll') private chatScroll?: ElementRef<HTMLElement>;

  agentName = 'Artifacts Generator';
  phase = 'Phase 5 · OneLake Delta Tables & Reports';
  nextPhaseRoute = '/';
  nextPhaseName = 'Dashboard';

  readonly availableDestinations: DestinationType[] = ['Microsoft Fabric'];

  readonly quickPrompts: QuickPrompt[] = [
    { label: 'Change destination', icon: 'bi-arrow-left-right', query: 'Change destination' },
    { label: 'Current destination', icon: 'bi-geo-alt', query: 'Show my current destination' },
    { label: 'What gets deployed?', icon: 'bi-box-seam', query: 'What gets deployed?' },
    { label: 'Scan & generate', icon: 'bi-database', query: 'How do I generate the artifacts?' }
  ];

  messages = signal<ArtifactsChatMessage[]>([]);
  isTyping = signal(false);
  showDestinationCard = signal(false);
  connectionError = signal<string | null>(null);
  fieldErrors = signal<Record<string, boolean>>({});
  destination = this.scanner.fabricDestination;

  selectedDestination: DestinationType | '' = '';
  form: FabricConnectionDetails = this.emptyForm();
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

  private nextId = 1;
  private shouldScroll = false;

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
    this.agentSays(
      "Hi, I'm the Artifacts Generator. I deploy your migration output (Delta tables, Data Factory pipelines, " +
      'views and stored procedures) into the destination you choose.'
    );

    const saved = this.scanner.getFabricDestination();
    if (saved) {
      this.showDestinationCard.set(false);
      this.agentSays(`You last deployed to Microsoft Fabric workspace ${saved.workspaceId}. Do you want to keep using it?`, {
        actions: [
          { label: 'Use saved destination', icon: 'bi-check2-circle', action: 'use-saved', primary: true },
          { label: 'Enter new details', icon: 'bi-pencil', action: 'new-destination' }
        ]
      });
    } else {
      this.openDestinationCard();
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
      case 'go-scan':
        this.router.navigate(['/dbscanner']);
        break;
    }
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
          ? 'Run a database scan, then click Generate Artifacts on the results. Everything is created in the destination above.'
          : 'First choose a destination below, then run a database scan and click Generate Artifacts.',
        saved ? { actions: [{ label: 'Scan & generate artifacts', icon: 'bi-database', action: 'go-scan', primary: true }] } : undefined
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
    this.form = saved ? { ...saved } : this.emptyForm();
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

    const details = Object.fromEntries(
      Object.entries(this.form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    ) as unknown as FabricConnectionDetails;

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
      'Next, run a database scan. When it completes, click Generate Artifacts and they will be created in this destination.',
      {
        actions: [
          { label: 'Scan & generate artifacts', icon: 'bi-database', action: 'go-scan', primary: true },
          { label: 'Change destination', icon: 'bi-pencil', action: 'change-destination' }
        ]
      }
    );
  }

  private validate(): string | null {
    const f = this.form;
    const errors: Record<string, boolean> = {};
    if (!f.workspaceId?.trim()) errors['workspaceId'] = true;
    if (this.isServicePrincipal) {
      if (!f.tenantId?.trim()) errors['tenantId'] = true;
      if (!f.clientId?.trim()) errors['clientId'] = true;
      if (!f.clientSecret?.trim()) errors['clientSecret'] = true;
    }
    for (const key of ['workspaceId', 'tenantId', 'lakehouseId', 'warehouseId'] as const) {
      const value = (f[key] || '').trim();
      if (value && !GUID_PATTERN.test(value)) errors[key] = true;
    }
    this.fieldErrors.set(errors);
    return Object.keys(errors).length
      ? 'Please fix the highlighted fields. IDs must be GUIDs like 00000000-0000-0000-0000-000000000000.'
      : null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  summaryRows(d: FabricConnectionDetails, workspaceName?: string): Array<{ label: string; value: string }> {
    return [
      { label: 'Destination', value: 'Microsoft Fabric' },
      { label: 'Workspace', value: workspaceName ? `${workspaceName} (${d.workspaceId})` : d.workspaceId },
      { label: 'Tenant', value: d.tenantId || 'Default Azure credential' },
      { label: 'Lakehouse', value: d.lakehouseName || d.lakehouseId || 'Auto-created per source' },
      { label: 'Warehouse', value: d.warehouseName || d.warehouseId || d.warehouseHost || 'Not configured' }
    ];
  }

  private agentSays(text: string, extra?: Pick<ArtifactsChatMessage, 'details' | 'actions'>): void {
    this.push({ sender: 'agent', text, ...extra });
  }

  private userSays(text: string): void {
    this.push({ sender: 'user', text });
  }

  private push(msg: Omit<ArtifactsChatMessage, 'id' | 'timestamp'>): void {
    this.messages.update(list => [...list, { ...msg, id: this.nextId++, timestamp: new Date() }]);
    this.shouldScroll = true;
  }

  private emptyForm(): FabricConnectionDetails {
    return {
      workspaceId: '',
      tenantId: '',
      clientId: '',
      clientSecret: '',
      lakehouseId: '',
      lakehouseName: '',
      warehouseId: '',
      warehouseName: '',
      warehouseHost: '',
      authMode: 'servicePrincipal'
    };
  }
}
