import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AgentInfo } from '../models/agent.model';

@Injectable({
  providedIn: 'root'
})
export class HarnessDataService {
  private isSidebarCollapsed$ = new BehaviorSubject<boolean>(false);
  sidebarCollapsed$ = this.isSidebarCollapsed$.asObservable();

  private agents: AgentInfo[] = [
    {
      id: 'constraint-agent',
      phase: 1,
      name: 'Constraint Agent',
      sidebarName: 'Constraint Agent',
      sidebarSubtext: 'Rules • Governance • Keys',
      phaseTag: 'PHASE 1 · CONSTRAINT & GOVERNANCE',
      category: 'Governance & Integrity',
      color: '#f97316',
      accentBorder: '#f97316',
      bgTint: 'rgba(249, 115, 22, 0.1)',
      icon: 'bi-shield-check',
      status: 'live',
      badgeText: 'Phase 1',
      description: 'Enforces source constraints, validates primary and foreign key preservation, detects unsupported schema constructs, and applies enterprise governance guardrails before pipeline execution.',
      route: '/agents/constraint'
    },
    {
      id: 'discovery-agent',
      phase: 2,
      name: 'Discovery Agent',
      sidebarName: 'Discovery Agent',
      sidebarSubtext: 'Schema • compliance and ER',
      phaseTag: 'PHASE 2 · SCHEMA INTELLIGENCE',
      category: 'Source Discovery',
      color: '#0ea5e9',
      accentBorder: '#0ea5e9',
      bgTint: 'rgba(14, 165, 233, 0.1)',
      icon: 'bi-search',
      status: 'live',
      badgeText: 'Phase 2',
      description: 'Analyse your source platform — extracts full schema inventory, row counts, data types, ER relationships, and compliance signals from SQL Server, Oracle, PostgreSQL, Synapse, or Databricks.',
      route: '/agents/discovery'
    },
    {
      id: 'assessment-agent',
      phase: 3,
      name: 'Assessment Agent',
      sidebarName: 'Assessment Agent',
      sidebarSubtext: 'Readiness • Sizing • Risk',
      phaseTag: 'PHASE 3 · MIGRATION READINESS & SIZING',
      category: 'Assessment & Strategy',
      color: '#10b981',
      accentBorder: '#10b981',
      bgTint: 'rgba(16, 185, 129, 0.1)',
      icon: 'bi-clipboard-data',
      status: 'live',
      badgeText: 'Phase 3',
      description: 'Computes migration complexity scores, workload sizing, table dependency graphs, and risk ratings — generating comprehensive migration readiness reports with human review checkpoints.',
      route: '/agents/assessment'
    },
    {
      id: 'evaluation-agent',
      phase: 4,
      name: 'Evaluation Agent',
      sidebarName: 'Evaluation Agent',
      sidebarSubtext: 'Evaluator • Ground Truth',
      phaseTag: 'PHASE 4 · EVALUATOR-GENERATOR FEEDBACK',
      category: 'Quality & Feedback Loop',
      color: '#8b5cf6',
      accentBorder: '#8b5cf6',
      bgTint: 'rgba(139, 92, 246, 0.1)',
      icon: 'bi-cpu',
      status: 'live',
      badgeText: 'Phase 4',
      description: 'Performs automated evaluation and hallucination detection on agent outputs — validating LLM generated SQL against source schemas with a closed-loop critique mechanism.',
      route: '/agents/evaluation'
    },
    {
      id: 'migration-generator-agent',
      phase: 5,
      name: 'Migration Generator Agent',
      sidebarName: 'Migration Generator',
      sidebarSubtext: 'ETL • Fabric SQL & DLT',
      phaseTag: 'PHASE 5 · CODE & PIPELINE GENERATION',
      category: 'Code Transformation',
      color: '#6366f1',
      accentBorder: '#6366f1',
      bgTint: 'rgba(99, 102, 241, 0.1)',
      icon: 'bi-code-slash',
      status: 'live',
      badgeText: 'Phase 5',
      description: 'Converts legacy ETL code, stored procedures, views, and schemas into production-ready Microsoft Fabric Lakehouse/Warehouse SQL and Databricks Asset Bundles (DAB) + Delta Live Tables.',
      route: '/agents/migration-generator'
    },
    {
      id: 'medallion-generation-agent',
      phase: 6,
      name: 'Medallion Generation Agent',
      sidebarName: 'Medallion Generation',
      sidebarSubtext: 'Bronze • Silver • Gold',
      phaseTag: 'PHASE 6 · LAKEHOUSE ARCHITECTURE (UPCOMING)',
      category: 'Lakehouse Design',
      color: '#0d9488',
      accentBorder: '#0d9488',
      bgTint: 'rgba(13, 148, 136, 0.1)',
      icon: 'bi-layers',
      status: 'upcoming',
      badgeText: 'Phase 6',
      description: 'Designs Medallion architecture (Bronze / Silver / Gold), Unity Catalog / OneLake hierarchy across dev / staging / prod, data contracts with SLA definitions, and Lakehouse governance.',
      route: '/agents/medallion-generation'
    },
    {
      id: 'artifacts-generator',
      phase: 7,
      name: 'Artifacts Generator',
      sidebarName: 'Artifacts Generator',
      sidebarSubtext: 'Fabric Items • DDL • DOCX',
      phaseTag: 'PHASE 7 · ASSET PACKAGING & DEPLOYMENT',
      category: 'Delivery & Release',
      color: '#ec4899',
      accentBorder: '#ec4899',
      bgTint: 'rgba(236, 72, 153, 0.1)',
      icon: 'bi-box-seam',
      status: 'live',
      badgeText: 'Phase 7',
      description: 'Compiles migration deliverables into exportable artifacts — including Microsoft Fabric item JSONs, SQL DDL bundles, automated Word/PDF assessment docs, and deployment packages.',
      route: '/agents/artifacts-generator'
    }
  ];

  getAgents(): AgentInfo[] {
    return this.agents;
  }

  getAgentById(id: string): AgentInfo | undefined {
    return this.agents.find(a => a.id === id);
  }

  getLiveCount(): number {
    return this.agents.filter(a => a.status === 'live').length;
  }

  getUpcomingCount(): number {
    return this.agents.filter(a => a.status === 'upcoming').length;
  }

  toggleSidebar(): void {
    this.isSidebarCollapsed$.next(!this.isSidebarCollapsed$.value);
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.isSidebarCollapsed$.next(collapsed);
  }
}
