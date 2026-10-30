import { AfterViewChecked, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { HarnessDataService, SourceConnectionConfig } from '../../services/harness-data.service';
import {
  Scanner,
  AssessmentReadiness,
  AssessmentReport,
  AssessmentTable,
  AssessmentTier,
  ConstraintLogLine
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

export interface ChatRow {
  id: string;
  desc: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  /** Table key; clicking the row opens that table's assessment. */
  tableKey?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'agent' | 'user';
  text: string;
  timestamp: Date;
  tone?: 'error';
  metrics?: ChatMetricItem[];
  rows?: ChatRow[];
  logs?: ConstraintLogLine[];
  live?: boolean;
  /** Renders the interactive table explorer bound to the latest report. */
  explorer?: boolean;
  /** Renders the migration wave cards. */
  waves?: boolean;
  /** Renders one table's assessment card. */
  tableKey?: string;
  actions?: ChatActionItem[];
}

export interface QuickPrompt {
  label: string;
  query: string;
  icon: string;
}

type RunPhase = 'idle' | 'running' | 'streaming' | 'done' | 'error';
type LogFilter = 'all' | 'issues' | 'errors';
type SortKey = 'score' | 'rows' | 'size' | 'name';

const DEMO_SERVER = 'demo-catalog.enterprise.net';
const EXPLORER_PAGE = 12;
const READINESS_LABEL: Record<AssessmentReadiness, string> = {
  ready: 'Ready',
  needs_review: 'Needs review',
  blocked: 'Blocked'
};

@Component({
  selector: 'app-assessment-agent',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './assessment-agent.component.html',
  styleUrl: './assessment-agent.component.css'
})
export class AssessmentAgentComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('chatScroll') private chatScrollRef?: ElementRef<HTMLElement>;
  @ViewChild('liveConsole') private liveConsoleRef?: ElementRef<HTMLElement>;

  private router = inject(Router);
  private harnessDataService = inject(HarnessDataService);
  private scanner = inject(Scanner);

  agentName = 'Assessment Agent';
  phase = 'Phase 3 · Migration Readiness & Sizing';
  nextPhaseRoute = '/agents/migration-generator';
  nextPhaseName = 'Migration Generator Agent';

  readonly readinessLabel = READINESS_LABEL;

  readonly quickPrompts: QuickPrompt[] = [];

  userInput = '';

  messages = signal<ChatMessage[]>([]);
  report = signal<AssessmentReport | null>(null);
  runPhase = signal<RunPhase>('idle');
  consoleLines = signal<ConstraintLogLine[]>([]);
  logFilter = signal<LogFilter>('all');
  copied = signal(false);
  isReportDropdownOpen = signal(false);

  // Table explorer state (shared by every explorer card in the chat).
  tierFilter = signal<AssessmentTier | 'all'>('all');
  readinessFilter = signal<AssessmentReadiness | 'all'>('all');
  sortKey = signal<SortKey>('score');
  search = signal('');
  explorerLimit = signal(EXPLORER_PAGE);

  isBusy = computed(() => this.runPhase() === 'running' || this.runPhase() === 'streaming');
  verdict = computed(() => this.report()?.verdict ?? null);
  canProceed = computed(() => !!this.report() && this.report()!.verdict !== 'blocked' && !this.isBusy());

  getLockReason(): string {
    if (!this.isSourceConnected) {
      return 'Locked: Awaiting source database connection in Discovery Agent';
    }
    if (this.isBusy()) {
      return 'Locked: Evaluating table schemas and compiling assessment...';
    }
    if (!this.report()) {
      return 'Locked: Assessment has not been run yet';
    }
    if (this.report()!.verdict === 'blocked') {
      return 'Locked: Assessment is blocked by Layer 1 constraint errors. Resolve them in Constraint Agent.';
    }
    return '';
  }

  filteredTables = computed<AssessmentTable[]>(() => {
    const r = this.report();
    if (!r) return [];
    const tier = this.tierFilter();
    const ready = this.readinessFilter();
    const q = this.search().trim().toLowerCase();
    const list = Object.values(r.tables).filter(t =>
      (tier === 'all' || t.complexity === tier) &&
      (ready === 'all' || t.readiness === ready) &&
      (!q || t.key.toLowerCase().includes(q))
    );
    const by: Record<SortKey, (a: AssessmentTable, b: AssessmentTable) => number> = {
      score: (a, b) => b.complexity_score - a.complexity_score,
      rows: (a, b) => b.row_count - a.row_count,
      size: (a, b) => b.size_mb - a.size_mb,
      name: (a, b) => a.key.localeCompare(b.key)
    };
    return list.sort(by[this.sortKey()]);
  });

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
    const previous = this.harnessDataService.getAssessmentResult() as AssessmentReport | null;
    if (previous?.status === 'success' && previous.tables) {
      this.report.set(previous);
      this.runPhase.set('done');
      this.agentSays('Welcome back. This is the assessment from earlier in this session.', { logs: previous.logs });
      this.pushResultMessage(previous);
    } else {
      this.runAssessment(false, true);
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
  // Running the assessment
  // ---------------------------------------------------------------------------

  runAssessment(refresh: boolean, generateDocument = true): void {
    if (this.isBusy()) return;
    this.stopStream();
    this.consoleLines.set([]);
    this.logFilter.set('all');
    this.runPhase.set('running');

    const cfg = this.connectionConfig;
    const target = cfg ? `${cfg.platform} · ${cfg.server}${cfg.database ? ' / ' + cfg.database : ''}` : 'the connected source';
    this.agentSays(
      refresh
        ? `Re-extracting metadata from **${target}** and assessing every table…`
        : `Assessing migration readiness for **${target}**: sizing, complexity, load strategy and migration waves…`,
      { live: true }
    );

    this.scanner.generateAssessmentReport({ connection: this.buildConnectionPayload(), refresh, generate_document: generateDocument }).subscribe({
      next: (res) => {
        if (res?.status !== 'success') {
          this.handleFailure(res?.message || 'The assessment returned no result.', res?.logs || [], res?.code);
          return;
        }
        this.report.set(res);
        this.harnessDataService.setAssessmentResult(res);
        this.explorerLimit.set(EXPLORER_PAGE);
        this.streamLogs(res.logs || [], () => {
          this.runPhase.set('done');
          this.pushResultMessage(res);
        });
      },
      error: (err: HttpErrorResponse) => {
        const body = (err.error || {}) as Partial<AssessmentReport>;
        const message = body.message || (err.status === 0
          ? 'The backend is not reachable. Check that the Django server is running.'
          : `Assessment failed (${err.status} ${err.statusText}).`);
        this.handleFailure(message, body.logs || [], body.code);
      }
    });
  }

  private handleFailure(message: string, logs: ConstraintLogLine[], code?: string): void {
    const finish = () => {
      this.runPhase.set('error');
      const actions: ChatActionItem[] = [
        { label: 'Retry', action: 'rerun', icon: 'bi-arrow-repeat', primary: true },
        { label: 'Reconnect & re-extract', action: 'refresh', icon: 'bi-plug' }
      ];
      if (code === 'SOURCE_NOT_CONNECTED' || code === 'CONNECTION_FAILED') {
        actions.push({ label: 'Open Discovery Agent', action: 'discovery', icon: 'bi-hdd-network' });
      }
      this.agentSays(`**The assessment could not run.** ${message}`, { tone: 'error', actions });
    };
    if (logs.length) {
      this.streamLogs(logs, finish);
    } else {
      this.freezeLiveConsole();
      finish();
    }
  }

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
    const perLine = Math.max(25, Math.min(90, Math.floor(3000 / lines.length)));
    this.streamTimer = setInterval(() => {
      this.consoleLines.update(list => [...list, lines[i++]]);
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

  private freezeLiveConsole(): void {
    const snapshot = this.consoleLines();
    this.messages.update(list => list.map(m => (m.live ? { ...m, live: false, logs: snapshot } : m)));
  }

  private pushResultMessage(r: AssessmentReport): void {
    const s = r.summary;
    const verdictText = {
      ready: '**Ready to migrate.** Every table passed the readiness checks.',
      ready_with_review: `**Ready, with review.** ${s.readiness_breakdown.needs_review} table(s) need attention before or during migration.`,
      blocked: `**Blocked.** ${s.readiness_breakdown.blocked ? s.readiness_breakdown.blocked + ' table(s) have Layer 1 errors' : 'The Phase 2 constraint gate failed'}. Fix them in the Constraint Agent and re-run.`
    }[r.verdict];
    const origin = r.source?.metadata_origin;
    const originNote = origin === 'catalog_fallback'
      ? '\n\n**Note:** live extraction failed, so this assessment used the built-in sample catalog, not your database.'
      : origin === 'demo' ? '\n\n**Note:** Demo Simulation Mode data, not a live database.' : '';
    const docNote = r.report_file
      ? `\n- Assessment Report: \`${r.report_file}\``
      : r.document_error ? `\n- Assessment Report (.docx) failed: ${r.document_error}` : '';

    this.agentSays(
      `### Assessment complete\n\n${verdictText}\n\n` +
      `- Scope: **${s.total_tables}** tables, **${s.total_columns}** columns, **${s.total_rows.toLocaleString()}** rows, **${s.total_size_mb.toLocaleString()} MB** (~${s.est_onelake_size_mb.toLocaleString()} MB in OneLake, estimated)\n` +
      `- Complexity: **${s.complexity_breakdown.simple}** simple, **${s.complexity_breakdown.medium}** medium, **${s.complexity_breakdown.complex}** complex\n` +
      `- Readiness: **${s.readiness_breakdown.ready}** ready, **${s.readiness_breakdown.needs_review}** need review, **${s.readiness_breakdown.blocked}** blocked\n` +
      `- Migration waves: **${s.wave_count}** (dependencies: ${s.dependency_source})\n` +
      `- Constraint gate (Phase 2): **${s.constraints_gate}**${docNote}${originNote}`,
      {
        metrics: r.metrics
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
    const r = this.report();
    switch (action) {
      case 'next':
        if (this.canProceed()) {
          this.router.navigate([this.nextPhaseRoute]);
        } else {
          this.agentSays('The assessment is blocked, so the Migration Generator stays locked. Fix the Layer 1 errors in the Constraint Agent, then re-run.');
        }
        break;
      case 'constraints':
        this.router.navigate(['/agents/constraint']);
        break;
      case 'discovery':
        this.router.navigate(['/agents/discovery']);
        break;
      case 'rerun':
        this.userSays('Run the assessment again');
        this.runAssessment(false);
        break;
      case 'refresh':
        this.userSays('Reconnect and re-extract metadata');
        this.runAssessment(true);
        break;
      case 'view_doc':
        this.viewReport();
        break;
      case 'download_doc':
        this.downloadReport();
        break;
      default:
        this.answer(action);
    }
  }

  getReportFilename(): string {
    const r = this.report();
    if (r?.report_file) return r.report_file;
    const platform = (this.connectionConfig?.platform || 'sqlserver').toLowerCase();
    return `${platform}_Assessment_Report.docx`;
  }

  toggleReportDropdown(event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    this.isReportDropdownOpen.update(open => !open);
  }

  closeReportDropdown(): void {
    this.isReportDropdownOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.report-dropdown-wrapper')) {
      this.closeReportDropdown();
    }
  }

  viewReport(): void {
    this.closeReportDropdown();
    const r = this.report();
    if (r?.report_url) {
      window.open(r.report_url, '_blank', 'noopener');
    } else {
      const filename = this.getReportFilename();
      window.open(`/output/${filename}?view=1`, '_blank', 'noopener');
    }
  }

  downloadReport(): void {
    this.closeReportDropdown();
    const r = this.report();
    const filename = this.getReportFilename();
    const downloadUrl = r?.download_url || `/output/${filename}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  openTable(key: string): void {
    const t = this.report()?.tables[key];
    if (!t) return;
    this.userSays(`Show the assessment for ${key}`);
    this.agentSays(`### ${key}`, { tableKey: key });
  }

  sendMessage(customText?: string): void {
    const text = (customText ?? this.userInput).trim();
    if (!text || this.isBusy()) return;
    this.userSays(text);
    this.userInput = '';

    const q = text.toLowerCase();
    if (/(re-?run|again|repeat|run (the )?assessment)/.test(q)) return this.runAssessment(false);
    if (/(re-?extract|reconnect|refresh)/.test(q)) return this.runAssessment(true);
    if (/(proceed|next phase|migration generator)/.test(q)) return this.handleActionClick('next');
    this.answer(this.intentOf(q), q);
  }

  private intentOf(q: string): string {
    if (/(report|docx|word|document|download)/.test(q)) return 'report';
    if (/(explor|all tables|list tables|browse)/.test(q)) return 'explorer';
    if (/(wave|order|sequence|depend)/.test(q)) return 'waves';
    if (/(review|blocked|ready|readiness)/.test(q)) return 'readiness';
    if (/(incremental|load strategy|watermark|cdc|full load)/.test(q)) return 'load';
    if (/(direct ?lake|guardrail|capacity|sku)/.test(q)) return 'directlake';
    if (/(complex|difficult|hard|score)/.test(q)) return 'complex';
    if (/(largest|biggest|size|rows|volume)/.test(q)) return 'largest';
    if (/(constraint|gate|phase 2)/.test(q)) return 'gate';
    if (/(summary|overview|result|status)/.test(q)) return 'summary';
    return 'lookup';
  }

  /** Answers from the latest assessment only. */
  private answer(intent: string, query = ''): void {
    const r = this.report();
    if (!r) {
      this.agentSays('There is no assessment yet. Run it first.', {
        actions: [{ label: 'Run assessment', action: 'rerun', icon: 'bi-play-fill', primary: true }]
      });
      return;
    }
    const tables = Object.values(r.tables);
    const s = r.summary;

    switch (intent) {
      case 'explorer':
        this.agentSays('### Table explorer\n\nFilter by complexity or readiness, sort, search, and click a table for its full assessment.', { explorer: true });
        return;
      case 'waves':
        this.agentSays(
          `### Migration waves\n\nTables are ordered so each one loads after the tables it references (dependencies: **${s.dependency_source}**).` +
          (s.tables_in_cycles.length ? ` **${s.tables_in_cycles.length}** table(s) reference each other in a cycle and load together in the last wave.` : '') +
          ' Click a table for details.',
          { waves: true }
        );
        return;
      case 'complex': {
        const top = [...tables].sort((a, b) => b.complexity_score - a.complexity_score).slice(0, 8);
        this.agentSays(
          `### Most complex tables\n\nScores run 0–100 (simple < 25, medium < 50, complex ≥ 50) and add up volume, width, Fabric type changes, missing keys, relationships and sensitive data.`,
          { rows: top.map(t => this.tableRow(t, `${t.complexity} · ${t.complexity_score}/100 · ${t.score_factors.map(f => f.factor).join(', ') || 'no risk factors'}`)) }
        );
        return;
      }
      case 'readiness': {
        const open = tables.filter(t => t.readiness !== 'ready').sort((a, b) => (a.readiness === 'blocked' ? -1 : 1) - (b.readiness === 'blocked' ? -1 : 1));
        if (!open.length) {
          this.agentSays('Every table is ready. No reviews needed.');
          return;
        }
        this.readinessFilter.set(open.some(t => t.readiness === 'blocked') ? 'blocked' : 'needs_review');
        this.agentSays(
          `**${s.readiness_breakdown.blocked}** blocked and **${s.readiness_breakdown.needs_review}** need review. Showing the first ${Math.min(open.length, 15)}:`,
          {
            rows: open.slice(0, 15).map(t => this.tableRow(t, this.reviewReason(t)))
          }
        );
        return;
      }
      case 'load': {
        const inc = tables.filter(t => t.load_strategy.startsWith('Incremental'));
        const noWm = tables.filter(t => t.load_strategy.includes('no watermark'));
        this.agentSays(
          `### Load strategy\n\n- Full load: **${tables.length - inc.length - noWm.length}** table(s) under 1M rows\n- Incremental: **${inc.length}** table(s) with a change-tracking column\n- Large without a watermark column: **${noWm.length}** (consider CDC)`,
          { rows: [...inc, ...noWm].slice(0, 15).map(t => this.tableRow(t, t.load_strategy)) }
        );
        return;
      }
      case 'directlake':
        this.agentSays(
          s.direct_lake_over_guardrail.length
            ? `**${s.direct_lake_over_guardrail.length}** table(s) exceed the Direct Lake row guardrail for an F64 capacity (1.5 billion rows per table). They need aggregation or partitioning, or DirectQuery fallback.`
            : 'Every table is within the Direct Lake row guardrail for an F64 capacity (1.5 billion rows per table). Smaller capacities have lower limits.',
          { rows: s.direct_lake_over_guardrail.map(k => this.tableRow(r.tables[k], `${r.tables[k].row_count.toLocaleString()} rows`)) }
        );
        return;
      case 'largest': {
        const top = [...tables].sort((a, b) => b.size_mb - a.size_mb).slice(0, 8);
        this.agentSays('### Largest tables', {
          rows: top.map(t => this.tableRow(t, `${t.size_mb.toLocaleString()} MB · ${t.row_count.toLocaleString()} rows · ${t.load_strategy}`))
        });
        return;
      }
      case 'gate':
        this.agentSays(
          `The Phase 2 constraint gate is **${s.constraints_gate}**. ` +
          (s.constraints_gate === 'PASS' ? 'Column type changes, missing keys and sensitive columns from it feed into each table\'s score.' : 'Fix the failing rules in the Constraint Agent, then re-run the assessment.')
        );
        return;
      case 'report':
        if (r.report_file) {
          this.agentSays(`The Assessment Report is \`${r.report_file}\`.`);
        } else {
          this.agentSays(`The Word report wasn't generated${r.document_error ? ': ' + r.document_error : ''}.`);
        }
        return;
      case 'summary':
        this.pushResultMessage(r);
        return;
      default: {
        const key = this.findTable(query);
        if (key) {
          this.agentSays(`### ${key}`, { tableKey: key });
          return;
        }
        this.agentSays(
          'I can answer from the latest assessment: **complex tables**, **needs review**, **migration waves**, **load strategy**, **largest tables**, **Direct Lake**, the **report**, or any **table name**. Or open the **table explorer**.'
        );
      }
    }
  }

  private reviewReason(t: AssessmentTable): string {
    if (t.readiness === 'blocked') return `Blocked: ${t.blocking_issues[0] || 'Layer 1 error'}`;
    const parts: string[] = [];
    if (t.keys_declared && !t.primary_key.length) parts.push('no primary key');
    if (t.type_changes.length) parts.push(`${t.type_changes.length} type change(s)`);
    if (t.sensitive_columns.length) parts.push(`${t.sensitive_columns.length} sensitive column(s)`);
    return parts.join(', ') || 'Review';
  }

  private tableRow(t: AssessmentTable, desc: string): ChatRow {
    const status = t.readiness === 'blocked' ? 'fail' : t.readiness === 'needs_review' ? 'warn' : 'pass';
    return { id: t.key, desc, status, tableKey: t.key };
  }

  private findTable(query: string): string | null {
    const r = this.report();
    if (!r || !query) return null;
    const keys = Object.keys(r.tables);
    return keys.find(k => query.includes(k.toLowerCase())) ||
      keys.find(k => query.includes(r.tables[k].name.toLowerCase())) || null;
  }

  // ---------------------------------------------------------------------------
  // Template helpers
  // ---------------------------------------------------------------------------

  tableOf(key: string): AssessmentTable | null {
    return this.report()?.tables[key] ?? null;
  }

  tierClass(tier: AssessmentTier): string {
    return tier === 'Simple' ? 'tier-simple' : tier === 'Medium' ? 'tier-medium' : 'tier-complex';
  }

  readinessClass(r: AssessmentReadiness): string {
    return r === 'ready' ? 'pass' : r === 'needs_review' ? 'warn' : 'fail';
  }

  setTier(t: AssessmentTier | 'all'): void {
    this.tierFilter.set(t);
    this.explorerLimit.set(EXPLORER_PAGE);
  }

  setReadiness(r: AssessmentReadiness | 'all'): void {
    this.readinessFilter.set(r);
    this.explorerLimit.set(EXPLORER_PAGE);
  }

  showMore(): void {
    this.explorerLimit.update(n => n + EXPLORER_PAGE * 2);
  }

  countTier(t: AssessmentTier): number {
    const r = this.report();
    return r ? r.summary.complexity_breakdown[t.toLowerCase() as 'simple' | 'medium' | 'complex'] : 0;
  }

  countReadiness(k: AssessmentReadiness): number {
    return this.report()?.summary.readiness_breakdown[k] ?? 0;
  }

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

  copyLogs(lines?: ConstraintLogLine[]): void {
    const content = (lines ?? []).map(l => `${l.time} ${l.level.padEnd(6)} ${l.step ? '[' + l.step + '] ' : ''}${l.text}`).join('\n');
    if (!content) return;
    navigator.clipboard?.writeText(content).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 1500);
      },
      () => this.agentSays('Copying was blocked by the browser. Select the text and copy it manually.')
    );
  }

  clearChat(): void {
    this.closeReportDropdown();
    this.stopStream();
    this.messages.set([]);
    this.runPhase.set('idle');
    this.tierFilter.set('all');
    this.readinessFilter.set('all');
    this.search.set('');
    this.runAssessment(false);
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

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

  private agentSays(text: string, extra: Partial<ChatMessage> = {}): void {
    this.push({ sender: 'agent', text, ...extra });
  }

  private userSays(text: string): void {
    this.push({ sender: 'user', text });
  }

  private push(msg: Omit<ChatMessage, 'id' | 'timestamp'>): void {
    this.messages.update(list => [
      ...(msg.live ? list.map(m => (m.live ? { ...m, live: false } : m)) : list),
      { ...msg, id: `msg-${++this.msgSeq}`, timestamp: new Date() }
    ]);
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
