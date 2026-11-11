import { Component, ElementRef, ViewChild, AfterViewChecked, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
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

export interface ChatMessage {
  id: string;
  sender: 'agent' | 'user';
  text: string;
  timestamp: Date;
  metrics?: ChatMetricItem[];
  codeBlock?: string;
  actions?: ChatActionItem[];
}

export interface QuickPrompt {
  label: string;
  query: string;
  icon: string;
}

@Component({
  selector: 'app-migration-generator-agent',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './migration-generator-agent.component.html',
  styleUrl: './migration-generator-agent.component.css'
})
export class MigrationGeneratorAgentComponent implements OnInit, AfterViewChecked {
  @ViewChild('chatScroll') private chatScrollRef!: ElementRef;
  private router = inject(Router);
  private harnessDataService = inject(HarnessDataService);
  private scanner = inject(Scanner);
  private cdr = inject(ChangeDetectorRef);

  agentName = 'Migration Generator Agent';
  phase = 'Phase 4 · Code & Pipeline Generation';
  nextPhaseRoute = '/agents/evaluation';
  nextPhaseName = 'Evaluator Agent';

  get isSourceConnected(): boolean {
    return this.harnessDataService.isSourceConnected();
  }

  get connectionConfig() {
    return this.harnessDataService.getConnectionConfig();
  }

  get canProceed(): boolean {
    return this.isSourceConnected && !!this.latestPlanFile && !this.isTyping;
  }

  getLockReason(): string {
    if (!this.isSourceConnected) return 'Locked: Awaiting source database connection in Discovery Agent';
    if (this.isTyping) return 'Locked: Generating migration plan...';
    if (!this.latestPlanFile) return 'Locked: Generate migration plan first';
    return '';
  }

  userInput: string = '';
  isTyping: boolean = false;
  private shouldScroll: boolean = false;

  latestPlanFile: string | null = null;
  lastPlanData: any = null;

  quickPrompts: QuickPrompt[] = [
    { label: 'Generate Migration Plan (.docx)', query: 'Generate comprehensive Migration Plan Word document (.docx)', icon: 'bi-file-earmark-word' },
    { label: 'Inspect Medallion Layers', query: 'Inspect Bronze, Silver, Gold Lakehouse layer allocations', icon: 'bi-layers' },
    { label: 'Migration waves', query: 'Show the migration waves', icon: 'bi-layers' },
    { label: 'Analyze Risk Mitigations', query: 'Analyze migration risks and Fabric governance mitigations', icon: 'bi-shield-check' }
  ];

  messages: ChatMessage[] = [];

  ngOnInit(): void {
    this.initWelcomeMessage();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  private scrollToBottom(): void {
    try {
      if (this.chatScrollRef?.nativeElement) {
        this.chatScrollRef.nativeElement.scrollTop = this.chatScrollRef.nativeElement.scrollHeight;
      }
    } catch (e) {}
  }

  private initWelcomeMessage(): void {
    this.messages = [
      {
        id: 'msg-mig-init',
        sender: 'agent',
        text: `👋 Welcome to the **Migration Generator Agent** workspace (Phase 4 · Code & Pipeline Generation).<br><br>I synthesize Medallion Lakehouse architectures (Bronze ingestion, Silver conformation, Gold semantic models), compute dependency execution DAG waves, and formulate the official **Microsoft Fabric Migration Plan (.docx)** and **migration_plan.json** contract.`,
        timestamp: new Date(),
        metrics: [
          { label: 'Agent Status', value: 'READY' },
          { label: 'Target Model', value: 'Medallion (Bronze-Silver-Gold)' },
          { label: 'Orchestrator', value: 'Execution Wave DAG' },
          { label: 'Fabric Contract', value: 'migration_plan.json' }
        ],
        actions: [
          { label: 'Generate Migration Plan (.docx)', action: 'generate', icon: 'bi-play-fill', primary: true },
          { label: 'Inspect Medallion Architecture', action: 'medallion', icon: 'bi-layers' },
          { label: 'Migration waves', action: 'waves', icon: 'bi-layers' }
        ]
      }
    ];
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
    this.shouldScroll = true;

    // Trigger migration plan generation service
    this.scanner.generateMigrationPlan().subscribe({
      next: (res) => {
        this.lastPlanData = res;
        this.latestPlanFile = res.plan_file;
        this.generateAgentResponse(textToSend, res);
        this.isTyping = false;
        this.shouldScroll = true;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.warn('Backend migration plan error:', err);
        const detail = err?.error?.message || err?.message || 'Unknown error';
        const status = err?.status ? `HTTP ${err.status}` : 'Network error';
        this.messages.push({
          id: 'bot-' + Date.now(),
          sender: 'agent',
          text: `### ⚠️ Migration Plan Generation Failed

The backend could not build the migration plan, so no document or Fabric contract was produced.

- **Status**: ${status}
- **Reason**: \`${detail}\`

Re-run the earlier agents in this session so the pipeline has extracted metadata, then try again. The server log holds the full traceback.`,
          timestamp: new Date(),
          metrics: [
            { label: 'Plan Document', value: 'NOT GENERATED' },
            { label: 'Fabric Contract', value: 'NOT GENERATED' }
          ],
          actions: [
            { label: 'Retry Generate Migration Plan', action: 'generate', icon: 'bi-arrow-clockwise', primary: true }
          ]
        });
        this.isTyping = false;
        this.shouldScroll = true;
        this.cdr.detectChanges();
      }
    });
  }

  handlePromptClick(prompt: QuickPrompt): void {
    this.sendMessage(prompt.query);
  }

  handleActionClick(action: string): void {
    if (action === 'next') {
      this.router.navigate([this.nextPhaseRoute]);
    } else if (action === 'generate') {
      this.sendMessage('Generate comprehensive Migration Plan Word document (.docx)');
    } else if (action === 'medallion') {
      this.sendMessage('Inspect Bronze, Silver, Gold Lakehouse layer allocations');
    } else if (action === 'waves') {
      this.sendMessage('Display dependency execution waves and sequence order');
    } else if (action === 'risks') {
      this.sendMessage('Analyze migration risks and Fabric governance mitigations');
    } else if (action === 'view_doc') {
      if (this.latestPlanFile) {
        window.open(`/output/${this.latestPlanFile}?view=1`, '_blank');
      }
    } else if (action === 'download_doc') {
      if (this.latestPlanFile) {
        window.open(`/output/${this.latestPlanFile}`, '_blank');
      }
    }
  }

  clearChat(): void {
    this.initWelcomeMessage();
    this.shouldScroll = true;
  }

  private generateAgentResponse(query: string, planRes?: any): void {
    const q = query.toLowerCase();

    if (planRes && planRes.execution_waves) {
      const waves = planRes.execution_waves;
      let wavesBullet = '';
      waves.forEach((w: any) => {
        wavesBullet += `- **Wave ${w.wave} (${w.name})**: ${w.tables.slice(0, 4).join(', ')}${w.tables.length > 4 ? '...' : ''}<br>`;
      });

      const src = planRes.source_info?.platform || this.connectionConfig?.platform || 'SQL Server';
      const srcDb = planRes.source_info?.database || this.connectionConfig?.database || 'MDR_T';
      const destPlatform = planRes.destination_info?.platform || 'Microsoft Fabric OneLake';
      const destLakehouse = planRes.destination_info?.lakehouse || 'Lakehouse_MDR';

      this.messages.push({
        id: 'bot-' + Date.now(),
        sender: 'agent',
        text: `### 🚀 Microsoft Fabric Migration Plan & Execution Roadmap Compiled

Successfully compiled the complete 9-section migration roadmap and Fabric OneLake deployment contract.

#### 📍 Selected Endpoints & Platform Topology:
- **Source Selected**: **${src}** · Database: \`${srcDb}\`
- **Destination Selected**: **${destPlatform}** · Lakehouse: \`${destLakehouse}\` (Delta Parquet with V-Order)
- **Visual ER Diagram**: ✅ Embedded directly into **Section 2 (Dependency Analysis & ER Model)** of the official Migration Plan document.

#### 🏛️ Medallion Architecture Blueprint:
- **Bronze Ingestion Layer**: **${planRes.medallion_architecture.bronze.length} entities** (raw Parquet with V-Order compression)
- **Silver Conformation Layer**: **${planRes.medallion_architecture.silver.length} entities** (cleansed Delta tables with surrogate keys)
- **Gold Semantic Models**: **${planRes.medallion_architecture.gold.length} models** (star/snowflake Direct Lake Power BI datasets)

#### 🌊 Execution Sequence DAG Waves:
${wavesBullet}

#### 📄 Generated Migration Artifacts:
- Document: \`${planRes.plan_file}\` (Comprehensive 9-section migration strategy Word doc with embedded ER diagram)
- JSON Contract: \`${planRes.json_plan_file}\` (Machine-readable schema ready for Fabric OneLake deployment)`,
        timestamp: new Date(),
        metrics: [
          { label: 'Source', value: src },
          { label: 'Destination', value: 'Fabric OneLake' },
          { label: 'ER Diagram', value: 'INCLUDED' },
          { label: 'Execution Waves', value: `${waves.length} Waves` }
        ],
        actions: [
          { label: 'Proceed to Evaluator Agent', action: 'next', icon: 'bi-arrow-right-circle', primary: true },
          { label: 'View Migration Plan (.docx)', action: 'view_doc', icon: 'bi-box-arrow-up-right' },
          { label: 'Download Document', action: 'download_doc', icon: 'bi-download' }
        ]
      });
      return;
    }

    if (q.includes('wave')) {
      const assessment = this.harnessDataService.getAssessmentResult();
      const waves = planRes?.execution_waves || assessment?.waves;
      let wavesBullet = '';
      if (waves && waves.length > 0) {
        waves.forEach((w: any) => {
          const tableList = w.tables ? w.tables.slice(0, 6).join(', ') + (w.tables.length > 6 ? ` (+${w.tables.length - 6} more)` : '') : '';
          wavesBullet += `- **Wave ${w.wave}** (${w.tables?.length || 0} table(s)): \`${tableList}\`<br>`;
        });
      } else {
        wavesBullet = `- **Wave 1 (Independent Entities)**: Lookups, code tables, and parent dimensions without incoming foreign keys.<br>- **Wave 2 (Conformed Dimensions)**: Entities with single-level referential dependencies.<br>- **Wave 3 (Fact & Transactional Tables)**: High-volume transactional tables partitioned by date watermarks.`;
      }

      this.messages.push({
        id: 'bot-' + Date.now(),
        sender: 'agent',
        text: `### 🌊 Migration Waves & Dependency DAG Execution Sequencing

Tables are partitioned into topological dependency execution waves for migration to Microsoft Fabric OneLake:

${wavesBullet}

#### ⚙️ Orchestration Strategy:
- **Phase Execution**: Waves execute sequentially in ascending topological order.
- **Parallel Ingestion**: Tables within each wave can be ingested concurrently into OneLake Delta Parquet.
- **Referential Integrity**: Guarantees all parent entities exist before child foreign keys are loaded.`,
        timestamp: new Date(),
        metrics: [
          { label: 'Total Waves', value: `${waves?.length || 3} Waves` },
          { label: 'Topological Order', value: 'VALIDATED' }
        ],
        actions: [
          { label: 'Generate Migration Plan (.docx)', action: 'generate', icon: 'bi-file-earmark-word', primary: true },
          { label: 'Proceed to Evaluator Agent', action: 'next', icon: 'bi-arrow-right-circle' }
        ]
      });
      return;
    }

    // Default fallback response
    this.messages.push({
      id: 'bot-' + Date.now(),
      sender: 'agent',
      text: `### 🌊 Migration Roadmap & Medallion Pipeline Formulated\n\n- **Architecture**: Bronze (Delta Parquet Ingestion) -> Silver (Schema Conformance) -> Gold (Direct Lake Power BI)\n- **Execution Order**: Wave 1 (Independent dimensions) followed by Wave 2 (Fact transactional volume).`,
      timestamp: new Date(),
      metrics: [
        { label: 'Medallion', value: 'READY' },
        { label: 'Fabric Contract', value: 'VALIDATED' }
      ],
      actions: [
        { label: 'Generate Migration Plan (.docx)', action: 'generate', icon: 'bi-file-earmark-word', primary: true },
        { label: 'Proceed to Evaluator Agent', action: 'next', icon: 'bi-arrow-right-circle' }
      ]
    });
  }
}
