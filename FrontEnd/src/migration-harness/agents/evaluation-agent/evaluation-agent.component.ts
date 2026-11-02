import { AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';
import {
  Scanner,
  ConstraintLogLine,
  EvaluationReport
} from '../../../app/services/scanner/scanner';

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
  tone?: 'error';
  metrics?: ChatMetricItem[];
  codeBlock?: string;
  logs?: ConstraintLogLine[];
  live?: boolean;
  actions?: ChatActionItem[];
}

export interface QuickPrompt {
  label: string;
  query: string;
  icon: string;
}

type RunPhase = 'idle' | 'running' | 'done' | 'error';
type WorkspaceTab = 'rules' | 'console';

@Component({
  selector: 'app-evaluation-agent',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './evaluation-agent.component.html',
  styleUrl: './evaluation-agent.component.css'
})
export class EvaluationAgentComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('chatScroll') private chatScrollRef?: ElementRef<HTMLElement>;

  private router = inject(Router);
  public harnessDataService = inject(HarnessDataService);
  private scanner = inject(Scanner);

  agentName = 'Evaluation Agent';
  phase = 'Feedback Bridge · Evaluator-Generator Feedback Loop';
  nextPhaseRoute = '/agents/artifacts-generator';
  nextPhaseName = 'Artifacts Generator';

  readonly quickPrompts: QuickPrompt[] = [
    { label: 'Run Evaluation Audit', query: 'Run the closed-loop evaluation audit on all summaries and plans', icon: 'bi-play-fill' },
    { label: 'Anti-Hallucination Checks', query: 'Show all hallucination detection results and phantom column scans', icon: 'bi-shield-check' },
    { label: 'Ground Truth Schema Diff', query: 'Show table-by-table column list match against ground truth metadata', icon: 'bi-diagram-3' },
    { label: 'Artifact Verification', query: 'Verify Assessment Report, Migration Plan, and Fabric metadata completeness', icon: 'bi-box-seam' },
    { label: 'Raw Console Output', query: 'Show the Generator-Evaluator Feedback console logs', icon: 'bi-terminal' }
  ];

  userInput = '';
  copySuccess = false;

  messages = signal<ChatMessage[]>([]);
  report = signal<EvaluationReport | null>(null);
  runPhase = signal<RunPhase>('idle');
  consoleLines = signal<ConstraintLogLine[]>([]);
  activeTab = signal<WorkspaceTab>('rules');

  get isSourceConnected(): boolean {
    return this.harnessDataService.isSourceConnected();
  }

  isBusy = computed(() => this.runPhase() === 'running');

  canProceed = computed(() => {
    const rep = this.report();
    return this.isSourceConnected && rep !== null && rep.status === 'success';
  });

  ngOnInit(): void {
    if (!this.isSourceConnected) {
      return;
    }

    // Check cached result in harnessDataService
    const cached = this.harnessDataService.getEvaluationResult();
    if (cached) {
      this.report.set(cached);
      this.consoleLines.set(cached.logs || []);
      this.runPhase.set('done');
      this.addCachedReportMessage(cached);
      return;
    }

    // Initial greeting and auto-run
    this.addAgentGreeting();
    this.runEvaluationAudit();
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  ngOnDestroy(): void {}

  private scrollToBottom(): void {
    if (this.chatScrollRef?.nativeElement) {
      const el = this.chatScrollRef.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  private addAgentGreeting(): void {
    this.messages.set([
      {
        id: 'msg-init',
        sender: 'agent',
        text: 'Welcome to the **Evaluation Agent (Feedback Bridge)**. I am a closed-loop evaluator that validates AI-generated assessment summaries, data models, and migration plans against catalog ground-truth metadata to eliminate hallucinations and verify Microsoft Fabric Lakehouse compliance.',
        timestamp: new Date()
      }
    ]);
  }

  private addCachedReportMessage(rep: EvaluationReport): void {
    this.messages.set([
      {
        id: 'msg-cached',
        sender: 'agent',
        text: `Loaded existing **Evaluator-Generator Feedback** audit for **${rep.source.database}** (${rep.source.platform}).\n\nDecision: **${rep.decision}** · Quality: **${rep.ai_output_quality}** · Hallucinations: **${rep.hallucinations_detected}** detected · Fidelity Score: **${rep.quality_score}%**.`,
        timestamp: new Date(),
        metrics: rep.metrics
      }
    ]);
  }

  runEvaluationAudit(refresh: boolean = false): void {
    if (this.isBusy()) return;

    this.runPhase.set('running');

    const runningMsgId = 'msg-eval-' + Date.now();
    this.messages.update(prev => [
      ...prev,
      {
        id: runningMsgId,
        sender: 'agent',
        text: 'Executing **Harness Layer 2: Evaluator-Generator Feedback Harness**… auditing Table Summarizer observations, checking for AI column hallucinations, and diffing against ground-truth metadata.',
        timestamp: new Date(),
        live: true
      }
    ]);

    this.scanner.evaluatePipeline({ refresh }).subscribe({
      next: (res: EvaluationReport) => {
        this.runPhase.set('done');
        this.report.set(res);
        this.consoleLines.set(res.logs || []);
        this.harnessDataService.setEvaluationResult(res);
        this.harnessDataService.setEvaluationLogs(res.report_text);

        // Update the running message or add a success card
        this.messages.update(prev => {
          const filtered = prev.filter(m => m.id !== runningMsgId);
          return [
            ...filtered,
            {
              id: 'msg-res-' + Date.now(),
              sender: 'agent',
              text: `### Evaluator-Generator Feedback Audit Complete\n\n` +
                `* **Evaluator Decision**: \`${res.decision}\`\n` +
                `* **AI Output Quality**: \`${res.ai_output_quality}\`\n` +
                `* **Hallucinations**: **${res.hallucinations_detected} detected**\n` +
                `* **Architecture Alignment**: **Microsoft Fabric OneLake**\n` +
                `* **Artifacts Checked**: **${Object.values(res.artifacts || {}).filter(Boolean).length}/3 validated**\n\n` +
                (res.decision === 'PASS'
                  ? `All AI outputs match the underlying schema catalog with zero unhandled hallucinations. You may now proceed to **Artifacts Generator (Phase 5)** to deploy the OneLake Delta tables.`
                  : `One or more evaluation rules raised errors. Review the detailed findings below before proceeding.`),
              timestamp: new Date(),
              metrics: res.metrics,
              actions: [
                { label: 'View Audit Rules', action: 'tab-rules', icon: 'bi-shield-check', primary: true },
                { label: 'View Live Console', action: 'tab-console', icon: 'bi-terminal' }
              ]
            }
          ];
        });
      },
      error: (err: HttpErrorResponse) => {
        this.runPhase.set('error');
        const errDetail = err.error?.message || err.message || 'Failed to execute evaluator harness.';
        this.messages.update(prev => {
          const filtered = prev.filter(m => m.id !== runningMsgId);
          return [
            ...filtered,
            {
              id: 'msg-err-' + Date.now(),
              sender: 'agent',
              text: `**Evaluation Audit Failed**: ${errDetail}\n\nPlease ensure you have connected a source database in **Discovery Agent (Phase 1)** and generated assessments.`,
              timestamp: new Date(),
              tone: 'error',
              actions: [
                { label: 'Retry Evaluation', action: 'retry', icon: 'bi-arrow-clockwise', primary: true }
              ]
            }
          ];
        });
      }
    });
  }

  handleQuickPrompt(qp: QuickPrompt): void {
    if (this.isBusy()) return;

    this.messages.update(prev => [
      ...prev,
      {
        id: 'msg-u-' + Date.now(),
        sender: 'user',
        text: qp.query,
        timestamp: new Date()
      }
    ]);

    const rep = this.report();

    if (qp.label === 'Run Evaluation Audit') {
      this.runEvaluationAudit();
    } else if (qp.label === 'Anti-Hallucination Checks') {
      this.activeTab.set('rules');
      const hCount = rep?.hallucinations_detected || 0;
      this.messages.update(prev => [
        ...prev,
        {
          id: 'msg-a-' + Date.now(),
          sender: 'agent',
          text: `**Anti-Hallucination Audit Result:**\n\n` +
            `* **Status**: ${hCount === 0 ? '`SUCCESS - 0 Hallucinations`' : '`FAILED - ' + hCount + ' Detected`'}\n` +
            `* **Inspection Method**: Evaluates each table summary against ground-truth database catalog columns. Quoted identifiers in AI prose that do not exist in the source metadata are flagged.\n` +
            `* **Total Tables Audited**: ${rep?.table_evaluations?.length || 0} tables.`,
          timestamp: new Date()
        }
      ]);
    } else if (qp.label === 'Ground Truth Schema Diff') {
      this.activeTab.set('rules');
      this.messages.update(prev => [
        ...prev,
        {
          id: 'msg-a-' + Date.now(),
          sender: 'agent',
          text: `**Schema Ground Truth Diff:**\n\n` +
            `Each table's reported \`- Columns:\` block in the Assessment Report was diffed against the physical extracted schema. ${rep?.total_errors === 0 ? 'All column lists match 100% with no omissions or phantom entries.' : 'Check the Evaluation Rules and Console for specific discrepancies.'}`,
          timestamp: new Date()
        }
      ]);
    } else if (qp.label === 'Artifact Verification') {
      this.activeTab.set('rules');
      const artCount = Object.values(rep?.artifacts || {}).filter(Boolean).length;
      this.messages.update(prev => [
        ...prev,
        {
          id: 'msg-a-' + Date.now(),
          sender: 'agent',
          text: `**Generated Artifacts & Fabric JSON Completeness:**\n\n` +
            `* **Status**: ${artCount === 3 ? '`3 of 3 Deliverables Ready`' : '`' + artCount + ' of 3 Deliverables Found`'}\n` +
            `* **Assessment Report (.docx)**: ${rep?.artifacts?.assessment_report_docx ? '✅ Verified' : '⚠️ Missing'}\n` +
            `* **Migration Plan (.docx)**: ${rep?.artifacts?.migration_plan_docx ? '✅ Verified' : '⚠️ Missing'}\n` +
            `* **Fabric Migration Metadata JSON**: ${rep?.artifacts?.fabric_migration_metadata_json ? '✅ Verified' : '⚠️ Missing'}`,
          timestamp: new Date()
        }
      ]);
    } else if (qp.label === 'Raw Console Output') {
      this.activeTab.set('console');
      this.messages.update(prev => [
        ...prev,
        {
          id: 'msg-a-' + Date.now(),
          sender: 'agent',
          text: `Switched to the **Live Terminal Console** displaying the exact \`Harness Layer 2 - Evaluator-Generator Feedback Harness\` output matching phase_0.`,
          timestamp: new Date()
        }
      ]);
    }
  }

  handleActionClick(action: string): void {
    if (action === 'retry') {
      this.runEvaluationAudit();
    } else if (action === 'tab-rules') {
      this.activeTab.set('rules');
    } else if (action === 'tab-console') {
      this.activeTab.set('console');
    }
  }

  setTab(tab: WorkspaceTab): void {
    this.activeTab.set(tab);
  }

  clearChat(): void {
    this.addAgentGreeting();
  }

  copyConsole(): void {
    const text = this.report()?.report_text || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.copySuccess = true;
      setTimeout(() => {
        this.copySuccess = false;
      }, 2500);
    });
  }

  getLockReason(): string {
    if (!this.isSourceConnected) return 'Awaiting source database connection in Discovery Agent (Phase 1)';
    if (!this.report()) return 'Awaiting Evaluation Audit completion';
    return '';
  }
}
