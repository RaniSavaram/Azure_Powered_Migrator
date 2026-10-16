import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AgentInfo } from '../models/agent.model';

@Injectable({
  providedIn: 'root'
})
export class HarnessDataService {
  private activeHarnessModalAgent$ = new BehaviorSubject<AgentInfo | null>(null);
  activeAgentForModal$ = this.activeHarnessModalAgent$.asObservable();

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
      harnessLayerTitle: 'Harness Layer 1 — Constraint & Governance Harness',
      harnessLayerType: 'layer1',
      harnessDescription: 'Deterministic pre-execution verification layer auditing constraint compatibility, data privacy, and governance policies before any generative code transformations.',
      harnessChecks: [
        { name: 'Verifying database connection is established', completed_name: 'Verified database connection is established', rule: 'CONNECTION_ESTABLISHED', status: 'passed' },
        { name: 'Verifying authentication and token validity', completed_name: 'Verified authentication is successful', rule: 'AUTHENTICATION_SUCCESSFUL', status: 'passed' },
        { name: 'Checking primary and foreign key constraints', completed_name: 'Checked primary and foreign key constraints', rule: 'CONSTRAINTS_PRESERVED', status: 'passed' },
        { name: 'Checking constraint compatibility with Microsoft Fabric', completed_name: 'Checked constraint compatibility with Microsoft Fabric', rule: 'UNSUPPORTED_CONSTRAINT', status: 'passed', info_text: 'Monitored unsupported constraints: COMPUTED COLUMN, XML SCHEMA' },
        { name: 'Scanning column names for sensitive keywords & PII', completed_name: 'Scanned column names for sensitive keywords & PII', rule: 'SENSITIVE_DATA_SCAN', status: 'passed', info_text: 'Enterprise governance rules applied (SSN, PII, Credentials scanned)' }
      ],
      sampleLogs: [
        'HARNESS LAYER 1 - CONSTRAINT & GOVERNANCE HARNESS:',
        '--------------------------------------------------',
        '[CHECKED]: connection_validation',
        '    - Harness Steps:',
        '        * [SUCCESS]: Verified database connection is established',
        '        * [SUCCESS]: Verified authentication is successful',
        '        * [SUCCESS]: Verified credentials',
        '[CHECKED]: constraint_validation',
        '    - Harness Steps:',
        '        * [SUCCESS]: Checked primary and foreign key constraints',
        '        * [SUCCESS]: Validated constraint compatibility with Microsoft Fabric',
        '[CHECKED]: governance_data_type_validation',
        '    - Harness Steps:',
        '        * [SUCCESS]: Scanned schema for sensitive columns & PII keywords',
        '        * [SUCCESS]: Zero critical security violations detected'
      ],
      capabilities: [
        'Primary & Foreign Key Preservation Verification',
        'Fabric Warehouse & Lakehouse Constraint Compatibility Auditing',
        'Enterprise PII and Sensitive Data Pattern Scanning',
        'Unsupported Constraint Flags (Computed, XML, Spatial)'
      ]
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
      harnessLayerTitle: 'Discovery & Schema Extraction Harness',
      harnessLayerType: 'layer1',
      harnessDescription: 'Ensures deterministic metadata extraction fidelity, verifying table counts, column ordinal positions, and schema completeness against source catalogs.',
      harnessChecks: [
        { name: 'Source catalog introspection and schema discovery', completed_name: 'Introspected source database catalogs', rule: 'SCHEMA_INTROSPECTION', status: 'passed' },
        { name: 'Column type normalization & precision verification', completed_name: 'Normalized column datatypes to Target Parquet/Delta', rule: 'DATATYPE_MAPPING', status: 'passed' },
        { name: 'Entity Relationship (ER) dependency graph construction', completed_name: 'Constructed ER graph with foreign key lineages', rule: 'ER_GRAPH_VALIDATED', status: 'passed' },
        { name: 'Row counts and volume sizing extraction', completed_name: 'Extracted row counts and storage metrics per table', rule: 'METADATA_METRICS', status: 'passed' }
      ],
      sampleLogs: [
        'DISCOVERY HARNESS - METADATA EXTRACTION:',
        '--------------------------------------------------',
        '[INFO] Connecting to source catalog: SQL Server / Azure Synapse / Databricks',
        '[SUCCESS] Discovered 14 schemas, 48 tables, 612 columns',
        '[SUCCESS] Mapped data types to Fabric Delta Lake specifications',
        '[SUCCESS] Extracted ER relationships across 32 foreign key references',
        '[SUCCESS] Schema inventory snapshot committed with verification checksum'
      ],
      capabilities: [
        'Automated Schema, Table & Column Discovery',
        'ER Relationship & Foreign Key Lineage Mapping',
        'Dynamic Row Count & Storage Sizing Profiling',
        'Multi-Database Connectors (SQL Server, Oracle, Synapse, Databricks)'
      ]
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
      harnessLayerTitle: 'Assessment & Readiness Validation Harness',
      harnessLayerType: 'layer2',
      harnessDescription: 'Evaluates migration feasibility algorithms, validates wave dependency sequencing, and computes risk indices against enterprise migration benchmarks.',
      harnessChecks: [
        { name: 'Complexity scoring evaluation (Simple / Medium / High)', completed_name: 'Computed table migration complexity scores', rule: 'COMPLEXITY_INDEX', status: 'passed' },
        { name: 'Circular dependency and foreign key cycle detection', completed_name: 'Validated dependency DAG with zero unresolved cycles', rule: 'DAG_VALIDATION', status: 'passed' },
        { name: 'Migration Wave Partitioning (Waves 1 to 4)', completed_name: 'Sequenced tables into risk-optimized migration waves', rule: 'WAVE_PARTITIONING', status: 'passed' },
        { name: 'Fabric Capacity & SKU sizing estimation', completed_name: 'Calculated F-SKU / CU workload capacity estimates', rule: 'CAPACITY_SIZING', status: 'passed' }
      ],
      sampleLogs: [
        'ASSESSMENT HARNESS - READINESS EVALUATION:',
        '--------------------------------------------------',
        '[SUCCESS] Calculated Complexity Index: 28 Low, 14 Medium, 6 Complex tables',
        '[SUCCESS] Wave 1: 18 Independent reference tables ready for automated ingest',
        '[SUCCESS] Wave 2: 20 Transactional tables with mapped foreign dependencies',
        '[SUCCESS] Wave 3: 10 Analytical summary tables and partitioned views',
        '[SUCCESS] Migration Readiness Score: 94.2% (Approved for Gate 1 Review)'
      ],
      capabilities: [
        'Algorithmic Complexity & Migration Effort Scoring',
        'Automated Wave Planning & Table Dependency DAGs',
        'Fabric Capacity & SKU Sizing Estimations',
        'Gate 1 Human-in-the-Loop Review Milestone Generation'
      ]
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
      harnessLayerTitle: 'Harness Layer 2 — Evaluator-Generator Feedback Harness',
      harnessLayerType: 'layer2',
      harnessDescription: 'Bi-directional feedback harness that continuously critiques AI agent artifacts against schema ground truth, auto-correcting syntax and semantic inconsistencies.',
      harnessChecks: [
        { name: 'AI Foundry agent orchestration validation', completed_name: 'Connected to Microsoft AI Foundry Projects SDK', rule: 'ORCHESTRATION_VALIDATION', status: 'passed' },
        { name: 'Ground truth schema fidelity check', completed_name: 'Verified 100% column name & type adherence to source', rule: 'GROUND_TRUTH_CHECK', status: 'passed' },
        { name: 'Hallucination detection & entity validation', completed_name: 'Zero hallucinated column or table references detected', rule: 'HALLUCINATION_GUARD', status: 'passed' },
        { name: 'Semantic RAG knowledge base grounding', completed_name: 'Grounded against Fabric/Databricks migration rulebook', rule: 'RAG_GROUNDING', status: 'passed' },
        { name: 'Closed-loop critique & auto-correction cycle', completed_name: 'Executed 2 automated refinement iterations successfully', rule: 'FEEDBACK_CONVERGENCE', status: 'passed' }
      ],
      sampleLogs: [
        'HARNESS LAYER 2 - EVALUATOR-GENERATOR FEEDBACK HARNESS:',
        '--------------------------------------------------',
        '[CHECKED]: agent_orchestration_validation',
        '    - Harness Steps:',
        '        * [SUCCESS]: Connected to Microsoft AI Foundry Projects SDK',
        '        * [SUCCESS]: Initialized Table Summarizer Generator Agent (Azure AI Foundry)',
        '        * [SUCCESS]: Initialized Migration Plan Generator Agent (Azure AI Foundry)',
        '        * [SUCCESS]: Loaded Semantic RAG Migration Knowledge Base',
        '[CHECKED]: evaluator_ground_truth_assessment',
        '    - Harness Steps:',
        '        * [SUCCESS]: Evaluated 48 generated table plans against ground truth',
        '        * [SUCCESS]: Hallucination confidence score: 0.00% (No false entities)',
        '        * [SUCCESS]: Evaluator verified 100% column preservation fidelity'
      ],
      capabilities: [
        'Automated LLM Output Critique & Semantic Verification',
        'Real-time Hallucination Detection & Prevention',
        'Azure AI Foundry Multi-Agent Feedback Orchestration',
        'Continuous Convergence Loop with Ground Truth Cross-Referencing'
      ]
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
      harnessLayerTitle: 'Code Syntax & Semantic Validation Harness',
      harnessLayerType: 'layer2',
      harnessDescription: 'Static and semantic analysis engine verifying generated T-SQL / PySpark pipelines against Microsoft Fabric T-SQL surface and Spark 3.5 SQL engines.',
      harnessChecks: [
        { name: 'T-SQL dialect syntax validation for Fabric Warehouse', completed_name: 'Parsed T-SQL statements against Fabric grammar', rule: 'SYNTAX_VALIDATION', status: 'passed' },
        { name: 'Stored procedure logic conversion & cursor elimination', completed_name: 'Transformed cursor loops into set-based operations', rule: 'LOGIC_TRANSFORMATION', status: 'passed' },
        { name: 'Delta Lake ACID table creation DDL generation', completed_name: 'Generated Delta Lake DDL with partition keys & Z-Ordering', rule: 'DELTA_DDL_GENERATION', status: 'passed' },
        { name: 'Data Pipeline copy activity orchestration JSON', completed_name: 'Synthesized Fabric Data Factory pipeline activity specs', rule: 'PIPELINE_ORCHESTRATION', status: 'passed' }
      ],
      sampleLogs: [
        'MIGRATION GENERATOR HARNESS - CODE VALIDATION:',
        '--------------------------------------------------',
        '[INFO] Translating legacy source procedures to Fabric Warehouse SQL...',
        '[SUCCESS] Generated DDL scripts for 48 tables with OneLake Delta backing',
        '[SUCCESS] Converted 12 stored procedures (Cursors refactored to set-based CTEs)',
        '[SUCCESS] Generated Databricks Asset Bundles (DAB) & Delta Live Tables (DLT) manifests',
        '[SUCCESS] Code passed static analysis with 0 syntax errors and 0 deprecated functions'
      ],
      capabilities: [
        'Automated Legacy T-SQL / PL-SQL to Fabric Warehouse SQL Conversion',
        'Delta Live Tables (DLT) & Databricks Asset Bundles (DAB) Generation',
        'Fabric Data Factory Pipeline Orchestration JSON Synthesis',
        'Set-based Stored Procedure Optimization & Cursor Elimination'
      ]
    },
    {
      id: 'medallion-generation-agent',
      phase: 6,
      name: 'Medallion Generation Agent',
      sidebarName: 'Medallion Generation',
      sidebarSubtext: 'Bronze • Silver • Gold',
      phaseTag: 'PHASE 6 · LAKEHOUSE ARCHITECTURE',
      category: 'Lakehouse Design',
      color: '#0d9488',
      accentBorder: '#0d9488',
      bgTint: 'rgba(13, 148, 136, 0.1)',
      icon: 'bi-layers',
      status: 'live',
      badgeText: 'Phase 6',
      description: 'Designs Medallion architecture (Bronze / Silver / Gold), Unity Catalog / OneLake hierarchy across dev / staging / prod, data contracts with SLA definitions, and Lakehouse governance.',
      harnessLayerTitle: 'Medallion Architecture & Lineage Harness',
      harnessLayerType: 'layer3',
      harnessDescription: 'Audits multi-hop data refinement pipelines, ensuring schema evolution rules, surrogate key integrity, and SLA definitions are met across bronze, silver, and gold tiers.',
      harnessChecks: [
        { name: 'Bronze layer raw ingestion & schema-on-read validation', completed_name: 'Configured Bronze raw landing with append-only logs', rule: 'BRONZE_TIER_CHECK', status: 'passed' },
        { name: 'Silver layer deduplication & data cleansing rules', completed_name: 'Implemented Silver deduplication, CDC, and SCD Type 2 logic', rule: 'SILVER_TIER_CHECK', status: 'passed' },
        { name: 'Gold layer dimensional star-schema & aggregate views', completed_name: 'Structured Gold dimensional facts, dimensions, and Direct Lake views', rule: 'GOLD_TIER_CHECK', status: 'passed' },
        { name: 'Data contract & SLA adherence verification', completed_name: 'Verified data contracts with 99.9% freshness SLA boundaries', rule: 'DATA_CONTRACTS', status: 'passed' }
      ],
      sampleLogs: [
        'MEDALLION HARNESS - ARCHITECTURE VERIFICATION:',
        '--------------------------------------------------',
        '[INFO] Designing Lakehouse Medallion tiering in Microsoft Fabric OneLake...',
        '[SUCCESS] Bronze Tier: Raw Parquet/Delta landing configured for 48 tables',
        '[SUCCESS] Silver Tier: Cleansed, enriched, and SCD Type 2 tracking operational',
        '[SUCCESS] Gold Tier: 8 Fact tables, 14 Dimension tables ready for Direct Lake Power BI',
        '[SUCCESS] Lineage DAG mapped end-to-end with automated SLA contracts'
      ],
      capabilities: [
        'End-to-end Bronze, Silver, Gold Multi-Hop Pipeline Architecture',
        'Slowly Changing Dimension (SCD Type 1 & 2) Logic Automation',
        'Direct Lake Power BI Dimensional Model Synthesis',
        'Unity Catalog / Fabric Workspace Multi-Environment Governance'
      ]
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
      harnessLayerTitle: 'Artifacts Release Gate Harness',
      harnessLayerType: 'layer3',
      harnessDescription: 'Release validation harness verifying artifact completeness, package checksums, and deployment manifests before push to Git or Fabric workspaces.',
      harnessChecks: [
        { name: 'Fabric Warehouse & Lakehouse JSON item manifest compilation', completed_name: 'Compiled Fabric item definitions (Warehouse, Notebooks, Pipelines)', rule: 'ITEM_MANIFEST', status: 'passed' },
        { name: 'Comprehensive Migration Assessment Word (.docx) report', completed_name: 'Generated executive-ready Word assessment document', rule: 'DOCX_REPORT', status: 'passed' },
        { name: 'SQL DDL script packaging and ZIP bundle compression', completed_name: 'Bundled all migration DDL scripts into release ZIP archive', rule: 'ZIP_PACKAGING', status: 'passed' },
        { name: 'Git repository release tagging and deployment gate review', completed_name: 'Prepared Gate 2 sign-off report and deployment manifests', rule: 'RELEASE_GATE', status: 'passed' }
      ],
      sampleLogs: [
        'ARTIFACTS HARNESS - RELEASE GATE VERIFICATION:',
        '--------------------------------------------------',
        '[INFO] Assembling migration release bundle...',
        '[SUCCESS] Compiled 48 Fabric Warehouse SQL script files',
        '[SUCCESS] Generated Migration_Assessment_Report.docx (Full technical briefing)',
        '[SUCCESS] Synthesized Fabric Pipeline JSON definitions and notebook artifacts',
        '[SUCCESS] Release archive created: Migration_Artifacts_v1.0.zip',
        '[SUCCESS] Gate 2 Release Gate PASSED — Artifacts ready for deployment'
      ],
      capabilities: [
        'Automated Word (.docx) & PDF Executive Assessment Reports',
        'Microsoft Fabric REST API Item Definition JSON Generator',
        'One-Click Downloadable Migration Scripts ZIP Archive',
        'Git Repository CI/CD Deployment Manifest Generation'
      ]
    }
  ];

  getAgents(): AgentInfo[] {
    return this.agents;
  }

  getAgentById(id: string): AgentInfo | undefined {
    return this.agents.find(a => a.id === id);
  }

  openHarnessModal(agent: AgentInfo): void {
    this.activeHarnessModalAgent$.next(agent);
  }

  closeHarnessModal(): void {
    this.activeHarnessModalAgent$.next(null);
  }

  toggleSidebar(): void {
    this.isSidebarCollapsed$.next(!this.isSidebarCollapsed$.value);
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.isSidebarCollapsed$.next(collapsed);
  }
}
