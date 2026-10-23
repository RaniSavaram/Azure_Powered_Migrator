import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AgentInfo, AgentExecutionStatus } from '../models/agent.model';

@Injectable({
  providedIn: 'root'
})
export class HarnessDataService {
  private isSidebarCollapsed$ = new BehaviorSubject<boolean>(false);
  sidebarCollapsed$ = this.isSidebarCollapsed$.asObservable();

  /**
   * 7 Agents: 6 Live agents (Phases 1-6) and Medallion moved to the last (Upcoming, grayed out)
   */
  private agentsList: AgentInfo[] = [
    {
      id: 'constraint-agent',
      phase: 1,
      name: 'Constraint Agent',
      sidebarName: 'Constraint Agent',
      sidebarSubtext: 'Rules • Governance • Fabric Guardrails',
      phaseTag: 'PHASE 1 · CONSTRAINT & GOVERNANCE',
      category: 'Governance & Integrity',
      color: '#f97316',
      accentBorder: '#f97316',
      bgTint: 'rgba(249, 115, 22, 0.1)',
      icon: 'bi-shield-check',
      status: 'live',
      executionStatus: 'idle',
      badgeText: 'Phase 1',
      description: 'Enforces deterministic Layer 1 migration guardrails — validates primary/foreign keys, checks Microsoft Fabric compatibility, filters unsupported schema constructs, and audits enterprise security policies.',
      route: '/agents/constraint'
    },
    {
      id: 'discovery-agent',
      phase: 2,
      name: 'Discovery Agent',
      sidebarName: 'Discovery Agent',
      sidebarSubtext: 'Multi-Source • Schema Catalog • ER',
      phaseTag: 'PHASE 2 · SCHEMA INTELLIGENCE',
      category: 'Source Discovery',
      color: '#0ea5e9',
      accentBorder: '#0ea5e9',
      bgTint: 'rgba(14, 165, 233, 0.1)',
      icon: 'bi-search',
      status: 'live',
      executionStatus: 'idle',
      badgeText: 'Phase 2',
      description: 'Extracts comprehensive schema catalog metadata across SQL Server, Databricks, Snowflake, and Synapse — capturing tables, views, procedures, volumes, and interactive ER relationships.',
      route: '/agents/discovery'
    },
    {
      id: 'assessment-agent',
      phase: 3,
      name: 'Assessment Agent',
      sidebarName: 'Assessment Agent',
      sidebarSubtext: 'AI Foundry • Sizing • Object Readiness',
      phaseTag: 'PHASE 3 · MIGRATION READINESS & SIZING',
      category: 'Assessment & Strategy',
      color: '#10b981',
      accentBorder: '#10b981',
      bgTint: 'rgba(16, 185, 129, 0.1)',
      icon: 'bi-clipboard-data',
      status: 'live',
      executionStatus: 'idle',
      badgeText: 'Phase 3',
      description: 'Powered by Azure AI Foundry Table Summarizer — analyzes object structures, data volume sizing, column definitions, and dependencies to produce structured migration readiness assessments.',
      route: '/agents/assessment'
    },
    {
      id: 'evaluation-agent',
      phase: 4,
      name: 'Evaluation Agent',
      sidebarName: 'Evaluation Agent',
      sidebarSubtext: 'Ground Truth • Audit • Critique Loop',
      phaseTag: 'FEEDBACK BRIDGE · EVALUATION & AUDIT',
      category: 'Quality & Feedback Loop',
      color: '#8b5cf6',
      accentBorder: '#8b5cf6',
      bgTint: 'rgba(139, 92, 246, 0.1)',
      icon: 'bi-cpu',
      status: 'live',
      executionStatus: 'idle',
      badgeText: 'Bridge',
      description: 'Closed-loop AI evaluator that audits assessment summaries and migration plans against source schema ground truth — eliminating hallucinations and ensuring architectural precision.',
      route: '/agents/evaluation'
    },
    {
      id: 'migration-generator-agent',
      phase: 4,
      name: 'Migration Generator Agent',
      sidebarName: 'Migration Generator',
      sidebarSubtext: '9-Section Plan • 5 Batches • Fabric Arch',
      phaseTag: 'PHASE 4 · FABRIC MIGRATION & BATCH PLANNING',
      category: 'Code Transformation',
      color: '#6366f1',
      accentBorder: '#6366f1',
      bgTint: 'rgba(99, 102, 241, 0.1)',
      icon: 'bi-code-slash',
      status: 'live',
      executionStatus: 'idle',
      badgeText: 'Phase 4',
      description: 'Generates complete 9-section migration plans — establishing topological execution order, 5-stage dependency batching, Full vs Incremental load strategies, and Microsoft Fabric target architecture.',
      route: '/agents/migration-generator'
    },
    {
      id: 'artifacts-generator',
      phase: 5,
      name: 'Artifacts Generator',
      sidebarName: 'Artifacts Generator',
      sidebarSubtext: 'Delta Tables • Docx • JSON Plan',
      phaseTag: 'PHASE 5 · ONELAKE DELTA TABLES & REPORTS',
      category: 'Fabric OneLake Deployment',
      color: '#ec4899',
      accentBorder: '#ec4899',
      bgTint: 'rgba(236, 72, 153, 0.1)',
      icon: 'bi-box-seam',
      status: 'live',
      executionStatus: 'idle',
      badgeText: 'Phase 5',
      description: 'Parses the AI assessment report and migration plan to provision Delta tables directly into Microsoft Fabric OneLake Lakehouse, generating downloadable Assessment Report (.docx) and migration_plan.json.',
      route: '/agents/artifacts-generator'
    },
    {
      id: 'medallion-generation-agent',
      phase: 7,
      name: 'Medallion Generation Agent',
      sidebarName: 'Medallion Generation',
      sidebarSubtext: 'Bronze • Silver • Gold Design',
      phaseTag: 'UPCOMING PHASE · LAKEHOUSE ARCHITECTURE',
      category: 'Lakehouse Design',
      color: '#64748b',
      accentBorder: '#94a3b8',
      bgTint: 'rgba(100, 116, 139, 0.1)',
      icon: 'bi-layers',
      status: 'upcoming',
      executionStatus: 'upcoming',
      badgeText: 'Upcoming',
      description: 'Automated Medallion lakehouse modeling — structuring raw Bronze ingestion, cleansed Silver relational entities, and Gold semantic models for Microsoft Fabric Power BI analytics.',
      route: '/agents/medallion-generation'
    }
  ];

  // Pipeline sequence of the 6 live phases (skipping medallion upcoming)
  private pipelineSequence: string[] = [
    'constraint-agent',
    'discovery-agent',
    'assessment-agent',
    'evaluation-agent',
    'migration-generator-agent',
    'artifacts-generator'
  ];

  private currentSequenceIndex = -1;
  private pipelineTimer: any = null;

  private agents$ = new BehaviorSubject<AgentInfo[]>(this.agentsList);
  agentsObservable$: Observable<AgentInfo[]> = this.agents$.asObservable();

  private runningAgentId$ = new BehaviorSubject<string | null>(null);
  activeRunningAgentId$: Observable<string | null> = this.runningAgentId$.asObservable();

  private pipelineState$ = new BehaviorSubject<'idle' | 'running' | 'completed'>('idle');
  pipelineStateObservable$: Observable<'idle' | 'running' | 'completed'> = this.pipelineState$.asObservable();

  private discoveryConversationDone$ = new BehaviorSubject<boolean>(false);
  discoveryConversationDoneObservable$: Observable<boolean> = this.discoveryConversationDone$.asObservable();

  setDiscoveryConversationDone(done: boolean = true): void {
    this.discoveryConversationDone$.next(done);
  }

  isDiscoveryDone(): boolean {
    return this.discoveryConversationDone$.value;
  }

  constructor() {
    // Starts completely idle. Does NOT run automatically on load.
  }

  getAgents(): AgentInfo[] {
    return this.agents$.value;
  }

  getAgentById(id: string): AgentInfo | undefined {
    return this.agents$.value.find(a => a.id === id);
  }

  getLiveCount(): number {
    return 5;
  }

  getUpcomingCount(): number {
    return 1;
  }

  toggleSidebar(): void {
    this.isSidebarCollapsed$.next(!this.isSidebarCollapsed$.value);
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.isSidebarCollapsed$.next(collapsed);
  }

  setRunningAgent(agentId: string | null): void {
    this.runningAgentId$.next(agentId);
    const updated = this.agentsList.map(agent => ({
      ...agent,
      executionStatus: (agent.status === 'upcoming' 
        ? 'upcoming' 
        : (agent.id === agentId ? 'running' : 'idle')) as AgentExecutionStatus
    }));
    this.agentsList = updated;
    this.agents$.next(updated);
  }

  getActiveRunningAgentId(): string | null {
    return this.runningAgentId$.value;
  }

  /**
   * Pipeline sequence running is disabled per user request.
   */
  startPipelineFrom(agentId?: string): void {
    if (this.pipelineTimer) {
      clearTimeout(this.pipelineTimer);
      this.pipelineTimer = null;
    }
    // No action
  }

  runSpecificAgent(agentId: string): void {
    // No action
  }

  private updateAgentStatuses(activeIdx: number): void {
    const updated = this.agentsList.map(agent => {
      if (agent.status === 'upcoming') {
        return { ...agent, executionStatus: 'upcoming' as AgentExecutionStatus };
      }
      const seqIdx = this.pipelineSequence.indexOf(agent.id);
      if (seqIdx === activeIdx) {
        return { ...agent, executionStatus: 'running' as AgentExecutionStatus };
      } else if (seqIdx < activeIdx) {
        return { ...agent, executionStatus: 'completed' as AgentExecutionStatus };
      } else {
        return { ...agent, executionStatus: 'idle' as AgentExecutionStatus };
      }
    });

    this.agentsList = updated;
    this.agents$.next(updated);
  }

  private updateAllCompleted(): void {
    const updated = this.agentsList.map(agent => {
      if (agent.status === 'upcoming') {
        return { ...agent, executionStatus: 'upcoming' as AgentExecutionStatus };
      }
      return { ...agent, executionStatus: 'completed' as AgentExecutionStatus };
    });

    this.agentsList = updated;
    this.agents$.next(updated);
  }

  resetPipeline(): void {
    if (this.pipelineTimer) {
      clearTimeout(this.pipelineTimer);
      this.pipelineTimer = null;
    }
    this.currentSequenceIndex = -1;
    this.runningAgentId$.next(null);
    this.pipelineState$.next('idle');

    const updated = this.agentsList.map(agent => ({
      ...agent,
      executionStatus: (agent.status === 'upcoming' ? 'upcoming' : 'idle') as AgentExecutionStatus
    }));

    this.agentsList = updated;
    this.agents$.next(updated);
  }
}
