import {
  AfterViewChecked,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';
import { Scanner } from '../../../app/services/scanner/scanner';

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

export interface ChatDetailRow {
  id: string;
  desc: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
}

export interface ChatMessage {
  id: string;
  sender: 'agent' | 'user';
  text: string;
  timestamp: Date;
  tone?: 'error';
  live?: boolean;
  metrics?: ChatMetricItem[];
  rows?: ChatDetailRow[];
  codeBlock?: string;
  actions?: ChatActionItem[];
}

export interface QuickPrompt {
  label: string;
  query: string;
  icon: string;
}

type RunPhase = 'idle' | 'running' | 'done' | 'error';

@Component({
  selector: 'app-migration-generator-agent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './migration-generator-agent.component.html',
  styleUrl: './migration-generator-agent.component.css'
})
export class MigrationGeneratorAgentComponent implements OnInit, AfterViewChecked {
  @ViewChild('chatScroll') private chatScrollRef?: ElementRef<HTMLElement>;

  private router = inject(Router);
  private harnessDataService = inject(HarnessDataService);
  private scanner = inject(Scanner);

  agentName = 'Migration Generator Agent';
  phase = 'Phase 4 · Code & Pipeline Generation';
  nextPhaseRoute = '/agents/evaluation';
  nextPhaseName = 'Evaluator Agent';

  readonly quickPrompts: QuickPrompt[] = [
    { label: 'Re-generate Migration Plan', query: 'Generate the Migration Plan (.docx) and Fabric contract again', icon: 'bi-arrow-clockwise' },
    { label: 'Medallion Layers', query: 'Inspect Bronze, Silver, and Gold Lakehouse layer allocations', icon: 'bi-layers' },
    { label: 'Migration Waves', query: 'Show the topological DAG execution waves', icon: 'bi-diagram-3' },
    { label: 'Risk Mitigations', query: 'Analyze migration risks and Fabric governance mitigations', icon: 'bi-shield-check' },
    { label: 'Fabric Contract', query: 'Inspect the migration_plan.json endpoint and schema contract', icon: 'bi-filetype-json' }
  ];

  messages = signal<ChatMessage[]>([]);
  lastPlanData = signal<any | null>(null);
  runPhase = signal<RunPhase>('idle');
  isReportDropdownOpen = signal(false);

  private shouldScroll = false;
  private msgSeq = 0;

  get isSourceConnected(): boolean {
    return this.harnessDataService.isSourceConnected();
  }

  get connectionConfig() {
    return this.harnessDataService.getConnectionConfig();
  }

  isBusy = computed(() => this.runPhase() === 'running');
  latestPlanFile = computed<string | null>(() => this.lastPlanData()?.plan_file ?? null);
  canProceed = computed(() => this.isSourceConnected && !!this.latestPlanFile() && !this.isBusy());

  getLockReason(): string {
    if (!this.isSourceConnected) return 'Locked: Awaiting source database connection in Discovery Agent';
    if (this.isBusy()) return 'Locked: Synthesizing Medallion blueprint and compiling Migration Plan...';
    if (!this.latestPlanFile()) return 'Locked: Generate Migration Plan first';
    return '';
  }

  ngOnInit(): void {
    if (!this.isSourceConnected) return;

    const cached = this.harnessDataService.getMigrationPlanResult();
    if (cached?.status === 'success' && cached?.plan_file) {
      this.lastPlanData.set(cached);
      this.runPhase.set('done');
      this.messages.set([this.buildPlanCompiledMessage(cached, 'msg-cached', true)]);
      return;
    }

    this.addAgentGreeting();
    this.runMigrationPlan();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.shouldScroll = false;
      const el = this.chatScrollRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && !target.closest('.report-dropdown-wrapper')) {
      this.isReportDropdownOpen.set(false);
    }
  }

  toggleReportDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.isReportDropdownOpen.update(open => !open);
  }

  getPlanFilename(): string {
    return this.latestPlanFile() || 'AI_Migration_Plan.docx';
  }

  viewPlan(): void {
    const file = this.latestPlanFile();
    if (!file) return;
    this.isReportDropdownOpen.set(false);
    window.open(`/output/${file}?view=1`, '_blank');
  }

  downloadPlan(): void {
    const file = this.latestPlanFile();
    if (!file) return;
    this.isReportDropdownOpen.set(false);
    window.open(`/output/${file}`, '_blank');
  }

  private nextId(prefix: string): string {
    this.msgSeq += 1;
    return `${prefix}-${Date.now()}-${this.msgSeq}`;
  }

  private addAgentGreeting(): void {
    this.messages.set([
      {
        id: this.nextId('init'),
        sender: 'agent',
        text: '### Migration Generator Agent Initialized\n\n' +
          'Synthesizing Microsoft Fabric Lakehouse Medallion layers (Bronze, Silver, Gold), computing topological execution DAG waves, and compiling the official **Migration Plan (.docx)** and `migration_plan.json` deployment contract.',
        timestamp: new Date()
      }
    ]);
    this.shouldScroll = true;
  }

  runMigrationPlan(): void {
    if (this.isBusy()) return;

    this.runPhase.set('running');
    const liveId = this.nextId('live');
    this.messages.update(prev => [
      ...prev,
      {
        id: liveId,
        sender: 'agent',
        text: 'Compiling 9-section **Microsoft Fabric Migration Plan (.docx)**, embedding Dependency ER Diagram, and generating `migration_plan.json`…',
        timestamp: new Date(),
        live: true
      }
    ]);
    this.shouldScroll = true;

    this.scanner.generateMigrationPlan().subscribe({
      next: (res: any) => {
        if (res?.status !== 'success') {
          this.handleFailure(liveId, res?.message || 'Migration plan generation returned no result.');
          return;
        }
        this.runPhase.set('done');
        this.lastPlanData.set(res);
        this.harnessDataService.setMigrationPlanResult(res);

        this.messages.update(prev => {
          const filtered = prev.filter(m => m.id !== liveId);
          return [...filtered, this.buildPlanCompiledMessage(res)];
        });
        this.shouldScroll = true;
      },
      error: (err: HttpErrorResponse) => {
        console.warn('Backend migration plan error:', err);
        const detail = err?.error?.message || err?.message || 'Unknown error';
        const status = err?.status ? `HTTP ${err.status}` : 'Network error';
        this.handleFailure(liveId, detail, status);
      }
    });
  }

  private handleFailure(liveId: string, errDetail: string, statusLabel = 'Error'): void {
    this.runPhase.set('error');
    this.messages.update(prev => {
      const filtered = prev.filter(m => m.id !== liveId);
      return [
        ...filtered,
        {
          id: this.nextId('err'),
          sender: 'agent',
          text: `### Migration Plan Generation Failed\n\n` +
            `The backend could not build the migration plan, so no document or Fabric contract was produced.\n\n` +
            `- **Status**: ${statusLabel}\n` +
            `- **Reason**: \`${errDetail}\`\n\n` +
            `Re-run the earlier agents in this session so the pipeline has extracted metadata, then try again. The server log holds the full traceback.`,
          timestamp: new Date(),
          tone: 'error',
          metrics: [
            { label: 'Plan Document', value: 'NOT GENERATED', color: '#ef4444' },
            { label: 'Fabric Contract', value: 'NOT GENERATED', color: '#ef4444' }
          ],
          actions: [
            { label: 'Retry Generate Migration Plan', action: 'generate', icon: 'bi-arrow-clockwise', primary: true }
          ]
        }
      ];
    });
    this.shouldScroll = true;
  }

  private buildPlanCompiledMessage(planRes: any, customId?: string, fromCache = false): ChatMessage {
    const waves = planRes.execution_waves || [];
    const src = planRes.source_info?.platform || this.connectionConfig?.platform || 'SQL Server';
    const srcDb = planRes.source_info?.database || this.connectionConfig?.database || 'Source Catalog';
    const destPlatform = planRes.destination_info?.platform || 'Microsoft Fabric (OneLake)';
    const destLakehouse = planRes.destination_info?.lakehouse || 'Fabric Lakehouse';

    const bronzeCount = planRes.medallion_architecture?.bronze?.length ?? 0;
    const silverCount = planRes.medallion_architecture?.silver?.length ?? 0;
    const goldCount = planRes.medallion_architecture?.gold?.length ?? 0;

    const intro = fromCache
      ? `Loaded compiled Migration Plan from earlier in this session for **${src} (${srcDb})**.`
      : `Compiled the complete 9-section migration roadmap, embedded Dependency ER Diagram, and generated the Fabric OneLake deployment contract.`;

    const wavesLines = waves
      .map((w: any) => `- **Wave ${w.wave} (${w.name})**: ${w.tables.slice(0, 4).join(', ')}${w.tables.length > 4 ? ` (+${w.tables.length - 4} more)` : ''}`)
      .join('\n');

    const text =
      `### Migration Plan & Execution Roadmap Compiled\n\n` +
      `${intro}\n\n` +
      `- **Source**: **${src}** · Database: \`${srcDb}\`\n` +
      `- **Destination**: **${destPlatform}** · Lakehouse: \`${destLakehouse}\` (Delta Parquet with V-Order)\n` +
      `- **Medallion Layers**: **${bronzeCount}** Bronze ingestion · **${silverCount}** Silver cleansed · **${goldCount}** Gold semantic\n` +
      `- **ER Diagram**: Embedded in **Section 2 (Dependency Analysis & ER Model)**\n` +
      `- **Artifacts**: \`${planRes.plan_file}\` and \`${planRes.json_plan_file || 'migration_plan.json'}\`\n\n` +
      (wavesLines ? `**Execution Sequence Waves (${waves.length})**\n${wavesLines}` : '');

    const metrics: ChatMetricItem[] = [
      { label: 'Source', value: src, color: '#0ea5e9' },
      { label: 'Destination', value: 'Fabric OneLake', color: '#8b5cf6' },
      { label: 'ER Diagram', value: planRes.has_er_diagram ? 'Included' : 'Pending', color: '#10b981' },
      { label: 'Execution Waves', value: `${waves.length} Waves`, color: '#06b6d4' }
    ];

    const actions: ChatActionItem[] = [
      { label: 'Inspect Medallion Layers', action: 'medallion', icon: 'bi-layers' },
      { label: 'Migration Waves', action: 'waves', icon: 'bi-diagram-3' },
      ...(planRes.plan_file ? [
        { label: 'View Plan', action: 'view_doc', icon: 'bi-box-arrow-up-right' },
        { label: 'Download .docx', action: 'download_doc', icon: 'bi-download' }
      ] : []),
      { label: 'Proceed to Evaluator Agent', action: 'next', icon: 'bi-arrow-right-circle', primary: true }
    ];

    return {
      id: customId || this.nextId('plan'),
      sender: 'agent',
      text,
      timestamp: new Date(),
      metrics,
      actions
    };
  }

  handlePromptClick(prompt: QuickPrompt): void {
    if (this.isBusy()) return;

    this.pushUserMessage(prompt.query);

    if (prompt.label === 'Re-generate Migration Plan') {
      this.runMigrationPlan();
    } else if (prompt.label === 'Medallion Layers') {
      this.showMedallionDetails();
    } else if (prompt.label === 'Migration Waves') {
      this.showWavesDetails();
    } else if (prompt.label === 'Risk Mitigations') {
      this.showRiskMitigations();
    } else if (prompt.label === 'Fabric Contract') {
      this.showFabricContract();
    }
  }

  handleActionClick(action: string): void {
    if (this.isBusy() && action !== 'view_doc' && action !== 'download_doc') return;

    switch (action) {
      case 'generate':
        this.pushUserMessage('Generate the Migration Plan (.docx) and Fabric contract');
        this.runMigrationPlan();
        break;
      case 'medallion':
        this.pushUserMessage('Inspect Bronze, Silver, and Gold Lakehouse layer allocations');
        this.showMedallionDetails();
        break;
      case 'waves':
        this.pushUserMessage('Show the topological DAG execution waves');
        this.showWavesDetails();
        break;
      case 'risks':
        this.pushUserMessage('Analyze migration risks and Fabric governance mitigations');
        this.showRiskMitigations();
        break;
      case 'view_doc':
        this.viewPlan();
        break;
      case 'download_doc':
        this.downloadPlan();
        break;
      case 'next':
        if (this.canProceed()) {
          this.router.navigate([this.nextPhaseRoute]);
        }
        break;
    }
  }

  private pushUserMessage(text: string): void {
    this.messages.update(prev => [
      ...prev,
      {
        id: this.nextId('usr'),
        sender: 'user',
        text,
        timestamp: new Date()
      }
    ]);
    this.shouldScroll = true;
  }

  private ensurePlanCompiledOrWarn(): any | null {
    const plan = this.lastPlanData();
    if (!plan) {
      this.messages.update(prev => [
        ...prev,
        {
          id: this.nextId('warn'),
          sender: 'agent',
          text: 'No compiled Migration Plan is available yet. Compile the plan first to inspect detailed topology and waves.',
          timestamp: new Date(),
          actions: [
            { label: 'Generate Migration Plan', action: 'generate', icon: 'bi-play-fill', primary: true }
          ]
        }
      ]);
      this.shouldScroll = true;
      return null;
    }
    return plan;
  }

  private showMedallionDetails(): void {
    const plan = this.ensurePlanCompiledOrWarn();
    if (!plan) return;

    const bronze: string[] = plan.medallion_architecture?.bronze || [];
    const silver: string[] = plan.medallion_architecture?.silver || [];
    const gold: string[] = plan.medallion_architecture?.gold || [];

    const rows: ChatDetailRow[] = [
      {
        id: 'BRONZE',
        desc: `Raw OneLake Delta ingestion (${bronze.length} tables): ${bronze.slice(0, 6).join(', ')}${bronze.length > 6 ? ` (+${bronze.length - 6} more)` : ''}`,
        status: 'info'
      },
      {
        id: 'SILVER',
        desc: `Cleansed & conformed schema layer (${silver.length} tables): ${silver.slice(0, 6).join(', ')}${silver.length > 6 ? ` (+${silver.length - 6} more)` : ''}`,
        status: 'pass'
      },
      {
        id: 'GOLD',
        desc: `Aggregated Direct Lake semantic models (${gold.length} models): ${gold.slice(0, 6).join(', ')}${gold.length > 6 ? ` (+${gold.length - 6} more)` : ''}`,
        status: 'pass'
      }
    ];

    this.messages.update(prev => [
      ...prev,
      {
        id: this.nextId('med'),
        sender: 'agent',
        text: `### Medallion Architecture Blueprint\n\n` +
          `Entities from **${plan.source_info?.database || 'Source'}** are mapped across three Microsoft Fabric Lakehouse tiers with V-Order Zstandard Parquet compression:`,
        timestamp: new Date(),
        metrics: [
          { label: 'Bronze Ingestion', value: `${bronze.length} Tables`, color: '#d97706' },
          { label: 'Silver Cleansed', value: `${silver.length} Tables`, color: '#0ea5e9' },
          { label: 'Gold Semantic', value: `${gold.length} Models`, color: '#10b981' }
        ],
        rows
      }
    ]);
    this.shouldScroll = true;
  }

  private showWavesDetails(): void {
    const plan = this.ensurePlanCompiledOrWarn();
    const assessment = this.harnessDataService.getAssessmentResult();
    const waves = plan?.execution_waves || assessment?.waves;
    if (!waves || waves.length === 0) {
      this.ensurePlanCompiledOrWarn();
      return;
    }

    const rows: ChatDetailRow[] = waves.map((w: any) => {
      const tables: string[] = w.tables || [];
      const preview = tables.slice(0, 6).join(', ') + (tables.length > 6 ? ` (+${tables.length - 6} more)` : '');
      return {
        id: `WAVE ${w.wave}`,
        desc: `${w.name || 'Execution Batch'} (${tables.length} items): ${preview}`,
        status: 'pass' as const
      };
    });

    this.messages.update(prev => [
      ...prev,
      {
        id: this.nextId('waves'),
        sender: 'agent',
        text: `### Migration Waves & Dependency DAG Sequencing\n\n` +
          `Objects are ordered in ascending topological dependency batches so parent lookup dimensions always ingest before dependent fact tables:`,
        timestamp: new Date(),
        metrics: [
          { label: 'Total Waves', value: `${waves.length} Waves`, color: '#8b5cf6' },
          { label: 'Topological DAG', value: 'Acyclic Pass', color: '#10b981' },
          { label: 'Load Concurrency', value: 'Parallel / Wave', color: '#06b6d4' }
        ],
        rows
      }
    ]);
    this.shouldScroll = true;
  }

  private showRiskMitigations(): void {
    const plan = this.ensurePlanCompiledOrWarn();
    if (!plan) return;

    const risks = plan.risk_mitigations || [];
    const rows: ChatDetailRow[] = risks.map((item: any, idx: number) => ({
      id: `RISK-0${idx + 1}`,
      desc: `${item.risk} — Mitigation: ${item.mitigation}`,
      status: 'warn' as const
    }));

    this.messages.update(prev => [
      ...prev,
      {
        id: this.nextId('risks'),
        sender: 'agent',
        text: `### Migration Risks & Fabric Governance Mitigations\n\n` +
          `Identified **${risks.length}** architectural guardrails incorporated into Section 9 of \`${plan.plan_file}\`:`,
        timestamp: new Date(),
        rows
      }
    ]);
    this.shouldScroll = true;
  }

  private showFabricContract(): void {
    const plan = this.ensurePlanCompiledOrWarn();
    if (!plan) return;

    const preview = JSON.stringify({
      source: plan.source_info,
      destination: plan.destination_info,
      er_diagram_included: plan.has_er_diagram,
      medallion_counts: {
        bronze: plan.medallion_architecture?.bronze?.length ?? 0,
        silver: plan.medallion_architecture?.silver?.length ?? 0,
        gold: plan.medallion_architecture?.gold?.length ?? 0
      },
      wave_count: plan.execution_waves?.length ?? 0,
      contract_file: plan.json_plan_file || 'migration_plan.json'
    }, null, 2);

    this.messages.update(prev => [
      ...prev,
      {
        id: this.nextId('contract'),
        sender: 'agent',
        text: `### Fabric Deployment Contract (\`${plan.json_plan_file || 'migration_plan.json'}\`)\n\n` +
          `Machine-readable schema contract linking source metadata, destination Lakehouse endpoints, and wave sequencing for **Artifacts Generator (Phase 6)**:`,
        timestamp: new Date(),
        codeBlock: preview
      }
    ]);
    this.shouldScroll = true;
  }

  clearChat(): void {
    const cached = this.lastPlanData();
    if (cached) {
      this.messages.set([this.buildPlanCompiledMessage(cached, 'msg-reset', true)]);
    } else {
      this.addAgentGreeting();
    }
    this.shouldScroll = true;
  }

  formatMessageText(rawText: string): string {
    if (!rawText) return '';
    let formatted = rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    formatted = formatted.replace(/^### (.*$)/gim, '<h4 class="chat-msg-title">$1</h4>');
    formatted = formatted.replace(/^## (.*$)/gim, '<h3 class="chat-msg-title">$1</h3>');
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
    formatted = formatted.replace(/^\s*[-•]\s+(.*)$/gim, '<li class="chat-bullet-item">$1</li>');
    formatted = formatted.replace(/(<li class="chat-bullet-item">.*?<\/li>\s*)+/gs, (match) => `<ul class="chat-bullet-list">${match}</ul>`);
    formatted = formatted.replace(/\n\n/g, '<div class="chat-spacer"></div>');
    formatted = formatted.replace(/(?<!>)\n(?!<)/g, '<br>');
    return formatted;
  }
}
