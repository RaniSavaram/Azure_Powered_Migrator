import { AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { HarnessDataService, SourceConnectionConfig } from '../../services/harness-data.service';
import {
  Scanner,
  ConstraintLogLine,
  ConstraintReport,
  ConstraintRule,
  ConstraintRuleStatus
} from '../../../app/services/scanner/scanner';

export interface ChatRuleItem {
  id: string;
  desc: string;
  status: ConstraintRuleStatus;
  /** Set when the row is a Layer 1 rule the user can click for its affected objects. */
  ruleRef?: ConstraintRule;
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
  tone?: 'error';
  metrics?: ChatMetricItem[];
  rules?: ChatRuleItem[];
  codeBlock?: string;
  codeTitle?: string;
  /** Layer 1 console lines; `live` renders the run that is still streaming. */
  logs?: ConstraintLogLine[];
  live?: boolean;
  actions?: ChatActionItem[];
}

export interface QuickPrompt {
  label: string;
  query: string;
  icon: string;
}

type RunPhase = 'idle' | 'running' | 'streaming' | 'done' | 'error';
type LogFilter = 'all' | 'issues' | 'errors';

const DEMO_SERVER = 'demo-catalog.enterprise.net';
const MAX_LISTED = 25;

@Component({
  selector: 'app-constraint-agent',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './constraint-agent.component.html',
  styleUrl: './constraint-agent.component.css'
})
export class ConstraintAgentComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('chatScroll') private chatScrollRef?: ElementRef<HTMLElement>;
  @ViewChild('liveConsole') private liveConsoleRef?: ElementRef<HTMLElement>;

  private router = inject(Router);
  public harnessDataService = inject(HarnessDataService);
  private scanner = inject(Scanner);

  agentName = 'Constraint Agent';
  phase = 'Phase 2 · Constraint & Governance';
  nextPhaseRoute = '/agents/assessment';
  nextPhaseName = 'Assessment Agent';

  readonly quickPrompts: QuickPrompt[] = [];

  userInput = '';

  messages = signal<ChatMessage[]>([]);
  report = signal<ConstraintReport | null>(null);
  runPhase = signal<RunPhase>('idle');
  consoleLines = signal<ConstraintLogLine[]>([]);
  logFilter = signal<LogFilter>('all');
  copied = signal(false);

  isBusy = computed(() => this.runPhase() === 'running' || this.runPhase() === 'streaming');
  gateDecision = computed(() => this.report()?.decision ?? null);
  canProceed = computed(() => this.report()?.decision === 'PASS' && !this.isBusy());

  getLockReason(): string {
    if (!this.isSourceConnected) {
      return 'Locked: Awaiting source database connection in Discovery Agent';
    }
    if (this.isBusy()) {
      return 'Locked: Executing Layer 1 constraint checks...';
    }
    if (!this.report()) {
      return 'Locked: Constraint checks have not been run yet';
    }
    if (this.report()!.decision === 'FAIL') {
      return 'Locked: Layer 1 constraint gate failed. Fix failing rules to proceed.';
    }
    return '';
  }

  private streamTimer: ReturnType<typeof setInterval> | null = null;
  private shouldScroll = false;
  private msgSeq = 0;

  get isSourceConnected(): boolean {
    return this.harnessDataService.isSourceConnected();
  }

  get connectionConfig(): SourceConnectionConfig | null {
    return this.harnessDataService.getConnectionConfig();
  }

  ngOnInit(): void {
    if (!this.isSourceConnected) return;

    // Reuse this session's previous run instead of re-checking on every visit.
    const previous = this.harnessDataService.getConstraintResult() as ConstraintReport | null;
    if (previous?.status === 'success' && previous.rules) {
      this.report.set(previous);
      this.runPhase.set('done');
      this.agentSays(`Welcome back. These are the constraint checks from ${this.formatTime(previous.generated_at)}.`, {
        logs: previous.logs
      });
      this.pushResultMessage(previous);
    } else {
      this.runAudit(false);
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.shouldScroll = false;
      const el = this.chatScrollRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }
    const consoleEl = this.liveConsoleRef?.nativeElement;
    if (consoleEl && this.runPhase() === 'streaming') consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  ngOnDestroy(): void {
    this.stopStream();
  }

  // ---------------------------------------------------------------------------
  // Running the checks
  // ---------------------------------------------------------------------------

  /** Calls Harness Layer 1 on the connected source; `refresh` re-extracts metadata first. */
  runAudit(refresh: boolean): void {
    if (this.isBusy()) return;
    this.stopStream();
    this.consoleLines.set([]);
    this.logFilter.set('all');
    this.runPhase.set('running');

    const cfg = this.connectionConfig;
    const target = cfg ? `${cfg.platform} · ${cfg.server}${cfg.database ? ' / ' + cfg.database : ''}` : 'the connected source';
    this.agentSays(
      refresh
        ? `Reconnecting to **${target}**, re-extracting metadata and running Harness Layer 1 checks…`
        : `Running Harness Layer 1 constraint checks on **${target}**…`,
      { live: true }
    );

    this.scanner.validateConstraints({ connection: this.buildConnectionPayload(), refresh }).subscribe({
      next: (res) => {
        if (res?.status !== 'success') {
          this.handleFailure(res?.message || 'The constraint check returned no result.', res?.logs || [], res?.code);
          return;
        }
        this.report.set(res);
        this.harnessDataService.setConstraintData(res.report_text, res);
        this.streamLogs(res.logs || [], () => {
          this.runPhase.set('done');
          this.pushResultMessage(res);
        });
      },
      error: (err: HttpErrorResponse) => {
        const body = (err.error || {}) as Partial<ConstraintReport>;
        const message = body.message || (err.status === 0
          ? 'The backend is not reachable. Check that the Django server is running.'
          : `Constraint check failed (${err.status} ${err.statusText}).`);
        this.handleFailure(message, body.logs || [], body.code);
      }
    });
  }

  private handleFailure(message: string, logs: ConstraintLogLine[], code?: string): void {
    const finish = () => {
      this.runPhase.set('error');
      const actions: ChatActionItem[] = [
        { label: 'Retry', action: 'audit', icon: 'bi-arrow-repeat', primary: true },
        { label: 'Reconnect & re-extract', action: 'refresh', icon: 'bi-plug' }
      ];
      if (code === 'SOURCE_NOT_CONNECTED' || code === 'CONNECTION_FAILED') {
        actions.push({ label: 'Open Discovery Agent', action: 'discovery', icon: 'bi-hdd-network' });
      }
      this.agentSays(`**Constraint checks could not run.** ${message}`, { tone: 'error', actions });
    };
    if (logs.length) {
      this.streamLogs(logs, finish);
    } else {
      this.freezeLiveConsole();
      finish();
    }
  }

  /** Reveals log lines one at a time so the user can follow each Layer 1 step. */
  private streamLogs(lines: ConstraintLogLine[], done: () => void): void {
    this.runPhase.set('streaming');
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || lines.length === 0) {
      this.consoleLines.set(lines);
      this.freezeLiveConsole();
      done();
      return;
    }

    let i = 0;
    const perLine = Math.max(25, Math.min(90, Math.floor(3500 / lines.length)));
    this.streamTimer = setInterval(() => {
      // Show a step's header and its findings together, then pause on the verdict.
      const next = lines[i++];
      this.consoleLines.update(list => [...list, next]);
      if (i >= lines.length) {
        this.stopStream();
        this.freezeLiveConsole();
        done();
      }
    }, perLine);
  }

  private stopStream(): void {
    if (this.streamTimer) {
      clearInterval(this.streamTimer);
      this.streamTimer = null;
    }
  }

  /** Turns the streaming console into a fixed snapshot so later runs don't overwrite it. */
  private freezeLiveConsole(): void {
    const snapshot = this.consoleLines();
    this.messages.update(list => list.map(m => (m.live ? { ...m, live: false, logs: snapshot } : m)));
  }

  private pushResultMessage(r: ConstraintReport): void {
    const s = r.summary;
    const origin = r.source?.metadata_origin;
    const originNote =
      origin === 'catalog_fallback'
        ? '\n\n**Note:** live extraction failed, so these checks ran on the built-in sample catalog, not your database. Reconnect in the Discovery Agent to check your real schema.'
        : origin === 'demo'
          ? '\n\n**Note:** this is Demo Simulation Mode data, not a live database.'
          : '';
    const verdict = r.decision === 'PASS'
      ? `**Gate decision: PASS.** The schema can move on to the Assessment Agent.`
      : `**Gate decision: FAIL.** Fix the failing rules below before moving on.`;

    this.agentSays(
      `### Layer 1 constraint checks complete\n\n${verdict}\n\n` +
      `- Scope: **${s.tables}** tables, **${s.views}** views, **${s.procedures}** procedures, **${s.columns}** columns\n` +
      `- Findings: **${s.errors}** error(s), **${s.warnings}** warning(s)\n` +
      `- Compliance score: **${r.compliance_score}%** (${r.score_basis || 'share of rules passing'})\n\n` +
      `Click a rule to see the affected tables and columns.${originNote}`,
      {
        metrics: r.metrics,
        rules: r.rules.map(rule => ({ id: rule.id, desc: rule.desc, status: rule.status, ruleRef: rule }))
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  handlePromptClick(prompt: QuickPrompt): void {
    this.sendMessage(prompt.query);
  }

  handleActionClick(action: string): void {
    switch (action) {
      case 'next':
        if (this.canProceed()) {
          this.router.navigate([this.nextPhaseRoute]);
        } else {
          this.agentSays('The gate has not passed yet, so the Assessment Agent stays locked. Fix the failing rules and re-run the checks.', {
            actions: [{ label: 'Show failing rules', action: 'issues', icon: 'bi-bug', primary: true }]
          });
        }
        break;
      case 'audit':
        this.userSays('Re-run the constraint checks');
        this.runAudit(false);
        break;
      case 'refresh':
        this.userSays('Reconnect and re-extract metadata');
        this.runAudit(true);
        break;
      case 'discovery':
        this.router.navigate(['/agents/discovery']);
        break;
      default:
        this.answer(action);
    }
  }

  handleRuleClick(item: ChatRuleItem): void {
    if (!item.ruleRef) return;
    this.userSays(`Show details for ${item.id}`);
    this.showRule(item.ruleRef);
  }

  sendMessage(customText?: string): void {
    const text = (customText ?? this.userInput).trim();
    if (!text || this.isBusy()) return;
    this.userSays(text);
    this.userInput = '';

    const q = text.toLowerCase();
    if (/(re-?run|again|repeat|run (the )?(checks|audit))/.test(q)) return this.runAudit(false);
    if (/(re-?extract|reconnect|refresh|re-?scan)/.test(q)) return this.runAudit(true);
    if (/(proceed|next phase|assessment)/.test(q)) return this.handleActionClick('next');
    this.answer(this.intentOf(q), q);
  }

  private intentOf(q: string): string {
    if (/(remediat|\bsql\b|\bddl\b|script|fix)/.test(q)) return 'remediations';
    if (/(primary|\bpk\b)/.test(q)) return 'pk';
    if (/(foreign|\bfk\b|relationship|referen)/.test(q)) return 'fk';
    if (/(type|datatype|unsupported|column change)/.test(q)) return 'datatypes';
    if (/(destructive|truncate|delete|drop)/.test(q)) return 'destructive';
    if (/(governance|naming|pii|sensitive|guardrail|compliance)/.test(q)) return 'governance';
    if (/(error|warning|issue|fail|problem)/.test(q)) return 'issues';
    if (/(log|console|trace)/.test(q)) return 'logs';
    if (/(score|summary|status|result|gate)/.test(q)) return 'summary';
    return 'lookup';
  }

  /** Answers from the latest Layer 1 report only - never from sample data. */
  private answer(intent: string, query = ''): void {
    const r = this.report();
    if (!r) {
      this.agentSays('There is no constraint result yet. Run the checks first.', {
        actions: [{ label: 'Run constraint checks', action: 'audit', icon: 'bi-play-fill', primary: true }]
      });
      return;
    }
    const rule = (id: string) => r.rules.find(x => x.id === id)!;

    switch (intent) {
      case 'pk': {
        const k = r.keys;
        if (!k.declared) {
          this.agentSays('The source catalog\'s declared keys could not be read for these tables, so primary key coverage is **unknown**. Check that the connected user can read the system catalog (e.g. `sys.key_constraints` on SQL Server).');
          return;
        }
        this.agentSays(
          `### Primary keys\n\n**${k.tables_with_pk} of ${k.tables_checked}** tables declare a primary key (**${k.pk_coverage ?? 0}%** coverage).` +
          (k.tables_without_pk.length ? ' Tables without one:' : ' Every table has one.'),
          { rules: this.listRows(k.tables_without_pk.map(t => ({ id: t, desc: 'No primary key: pick a business key before loading', status: 'warn' as const }))) }
        );
        this.showRule(rule('RULE-C01'), true);
        return;
      }
      case 'fk': {
        const k = r.keys;
        this.agentSays(
          `### Foreign keys\n\n- Declared: **${k.fk_total}**\n- Verified: **${k.fk_valid}**\n- Pointing outside the scanned tables: **${k.fk_out_of_scope}**\n- Broken (missing columns): **${k.fk_broken}**` +
          (k.fk_integrity !== null ? `\n\nIntegrity of checkable keys: **${k.fk_integrity}%**` : '')
        );
        this.showRule(rule('RULE-C02'), true);
        return;
      }
      case 'datatypes':
        if (!r.type_findings.length) {
          this.agentSays(rule('RULE-C03').skipped ? rule('RULE-C03').desc : 'Every column maps to a supported Microsoft Fabric type.');
          return;
        }
        this.agentSays(`### Fabric data types\n\n**${r.type_findings.length}** column(s) need a type change or review:`, {
          rules: this.listRows(r.type_findings.map(f => ({
            id: `${f.table}.${f.column}`,
            desc: `${f.source_type} → ${f.fabric_type}`,
            status: f.status === 'unsupported' ? 'warn' as const : 'info' as const
          })))
        });
        return;
      case 'destructive':
        this.showRule(rule('RULE-C04'));
        return;
      case 'governance':
        this.agentSays('### Governance checks', { rules: ['RULE-C05', 'RULE-C06', 'RULE-C07'].map(id => this.ruleRow(rule(id))) });
        return;
      case 'issues': {
        const open = r.rules.filter(x => x.status === 'fail' || x.status === 'warn');
        this.agentSays(
          open.length
            ? `**${r.summary.errors}** error(s) and **${r.summary.warnings}** warning(s). Rules that need attention:`
            : 'No errors or warnings. Every rule passed.',
          { rules: open.map(x => this.ruleRow(x)) }
        );
        return;
      }
      case 'remediations':
        this.agentSays('### Fabric remediation SQL\n\nGenerated from your schema. Fabric Warehouse keys are metadata only, so they are declared `NOT ENFORCED`.', {
          codeBlock: r.remediations,
          codeTitle: 'Fabric Warehouse DDL'
        });
        return;
      case 'logs':
        this.agentSays('### Layer 1 console', { logs: r.logs });
        return;
      case 'summary':
        this.pushResultMessage(r);
        return;
      default: {
        const table = this.findTable(query);
        if (table) {
          const t = r.tables[table];
          const findings = r.type_findings.filter(f => f.table === t.name);
          this.agentSays(
            `### ${table}\n\n- Columns: **${t.columns}**${t.row_count != null ? `, rows: **${t.row_count.toLocaleString()}**` : ''}\n` +
            `- Primary key: ${t.keys_declared ? (t.primary_key.length ? '`' + t.primary_key.join(', ') + '`' : '**none declared**') : 'unknown'}\n` +
            `- Foreign keys: ${t.foreign_keys.length ? t.foreign_keys.map(fk => `\`${fk.columns.join(', ')}\` → \`${fk.references}\``).join('; ') : 'none'}\n` +
            `- Columns needing a Fabric type change: ${findings.length ? findings.map(f => `\`${f.column}\` (${f.source_type} → ${f.fabric_type})`).join(', ') : 'none'}`
          );
          return;
        }
        this.agentSays(
          'I can answer from the latest Layer 1 run: **primary keys**, **foreign keys**, **data types**, **governance & PII**, **destructive SQL**, **errors**, **remediation SQL**, the **logs**, or any **table name**. You can also say **re-run** or **re-extract**.'
        );
      }
    }
  }

  private showRule(rule: ConstraintRule, quiet = false): void {
    const shown = rule.objects.slice(0, MAX_LISTED);
    const more = rule.count > shown.length ? rule.count - shown.length : 0;
    if (!shown.length) {
      if (!quiet) this.agentSays(`**${rule.id}**: ${rule.desc}. Nothing to show.`);
      return;
    }
    this.agentSays(
      `**${rule.id}**: ${rule.desc}.` + (more ? ` Showing ${shown.length} of ${rule.count}.` : ''),
      {
        rules: shown.map((o, i) => ({ id: `${i + 1}`, desc: o, status: rule.status }))
      }
    );
  }

  private ruleRow(rule: ConstraintRule): ChatRuleItem {
    return { id: rule.id, desc: rule.desc, status: rule.status, ruleRef: rule };
  }

  private listRows(rows: ChatRuleItem[]): ChatRuleItem[] {
    if (rows.length <= MAX_LISTED) return rows;
    return [...rows.slice(0, MAX_LISTED), { id: '…', desc: `${rows.length - MAX_LISTED} more`, status: 'info' }];
  }

  private findTable(query: string): string | null {
    const r = this.report();
    if (!r || !query) return null;
    const names = Object.keys(r.tables);
    return (
      names.find(n => query.includes(n.toLowerCase())) ||
      names.find(n => query.includes(r.tables[n].name.toLowerCase())) ||
      null
    );
  }

  // ---------------------------------------------------------------------------
  // Console helpers
  // ---------------------------------------------------------------------------

  visibleLogs(lines: ConstraintLogLine[] | undefined): ConstraintLogLine[] {
    const all = lines ?? [];
    switch (this.logFilter()) {
      case 'errors':
        return all.filter(l => l.level === 'ERROR' || l.level === 'FAIL');
      case 'issues':
        return all.filter(l => l.level !== 'INFO' && l.level !== 'PASS');
      default:
        return all;
    }
  }

  logCount(lines: ConstraintLogLine[] | undefined, level: 'errors' | 'warnings'): number {
    return (lines ?? []).filter(l => (level === 'errors' ? l.level === 'ERROR' : l.level === 'WARN')).length;
  }

  copyLogs(lines?: ConstraintLogLine[], text?: string): void {
    const content = text ?? (lines ?? []).map(l => `${l.time} ${l.level.padEnd(6)} ${l.step ? '[' + l.step + '] ' : ''}${l.text}`).join('\n');
    if (!content) return;
    navigator.clipboard?.writeText(content).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 1500);
      },
      () => this.agentSays('Copying was blocked by the browser. Select the text and copy it manually.')
    );
  }

  downloadText(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  clearChat(): void {
    this.stopStream();
    this.messages.set([]);
    this.runPhase.set('idle');
    this.runAudit(false);
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /** Connection the Discovery Agent made, so the backend can reconnect if it lost its metadata. */
  private buildConnectionPayload(): Record<string, unknown> | undefined {
    const c = this.connectionConfig;
    if (!c) return undefined;
    return {
      source: c.platform,
      platform: c.platform,
      server: c.server,
      port: c.port,
      database: c.database,
      catalog: c.catalog,
      username: c.username,
      demo_mode: c.server === DEMO_SERVER,
      extra: {
        http_path: c.httpPath,
        personalAccessToken: c.personalAccessToken,
        account: c.account,
        warehouse: c.warehouse,
        tenant_id: c.tenantId,
        client_id: c.clientId
      }
    };
  }

  private formatTime(iso?: string): string {
    if (!iso) return 'earlier in this session';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private agentSays(text: string, extra: Partial<ChatMessage> = {}): void {
    this.push({ sender: 'agent', text, ...extra });
  }

  private userSays(text: string): void {
    this.push({ sender: 'user', text });
  }

  private push(msg: Omit<ChatMessage, 'id' | 'timestamp'>): void {
    // A new live console replaces any previous one that is still marked live.
    this.messages.update(list => [
      ...(msg.live ? list.map(m => (m.live ? { ...m, live: false } : m)) : list),
      { ...msg, id: `msg-${++this.msgSeq}`, timestamp: new Date() }
    ]);
    this.shouldScroll = true;
  }

  formatMessageText(rawText: string): string {
    if (!rawText) return '';
    // Escape first: table/column names and user text must never become markup.
    let formatted = rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    formatted = formatted.replace(/^### (.*$)/gim, '<h4 class="chat-msg-title">$1</h4>');
    formatted = formatted.replace(/^## (.*$)/gim, '<h3 class="chat-msg-title">$1</h3>');
    formatted = formatted.replace(/^# (.*$)/gim, '<h2 class="chat-msg-title">$1</h2>');

    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');

    formatted = formatted.replace(/^\s*[-•]\s+(.*)$/gim, '<li class="chat-bullet-item">$1</li>');
    formatted = formatted.replace(/(<li class="chat-bullet-item">.*?<\/li>\s*)+/gs, (match) => `<ul class="chat-bullet-list">${match}</ul>`);

    formatted = formatted.replace(/\n\n/g, '<div class="chat-spacer"></div>');
    formatted = formatted.replace(/(?<!>)\n(?!<)/g, '<br>');

    return formatted;
  }
}
