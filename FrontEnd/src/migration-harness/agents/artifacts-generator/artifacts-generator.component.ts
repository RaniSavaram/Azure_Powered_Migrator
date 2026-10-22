import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

export interface ArtifactDeliverable {
  id: string;
  type: 'lakehouse' | 'reports' | 'pipelines';
  title: string;
  subtitle: string;
  description: string;
  status: 'Provisioned' | 'Generated' | 'Validated' | 'Ready';
  badge: string;
  target: string;
  icon: string;
  accentColor: string;
  actionLabel: string;
  actionIcon: string;
}

export interface AgentChatMessage {
  id: string;
  sender: 'agent' | 'user';
  text: string;
  timestamp: string;
  actions?: { label: string; actionId: string; icon: string }[];
}

@Component({
  selector: 'app-artifacts-generator',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './artifacts-generator.component.html',
  styleUrl: './artifacts-generator.component.css'
})
export class ArtifactsGeneratorComponent {
  agentName = 'Artifacts Generator';
  phase = 'Phase 5 · OneLake Delta Tables & Reports';
  nextPhaseRoute = '/';
  nextPhaseName = 'Dashboard';

  selectedSource = 'sqlserver';
  activeCategory: 'all' | 'lakehouse' | 'reports' | 'pipelines' = 'all';
  userInput = '';
  isProcessing = false;

  deliverables: ArtifactDeliverable[] = [
    {
      id: 'fabric-lakehouse',
      type: 'lakehouse',
      title: 'Microsoft Fabric OneLake Delta Tables',
      subtitle: 'Direct REST Delta Sync via delta-rs',
      description: 'Provisions source tables directly into Microsoft Fabric Lakehouse (SQL_Lakehouse) in Delta Parquet format with primary/foreign key parity.',
      status: 'Provisioned',
      badge: 'OneLake Delta Sync',
      target: 'SQL_Lakehouse · Fabric Insights Workspace',
      icon: 'bi-database-fill-check',
      accentColor: '#0ea5e9',
      actionLabel: 'View in Microsoft Fabric',
      actionIcon: 'bi-box-arrow-up-right'
    },
    {
      id: 'assessment-report-docx',
      type: 'reports',
      title: 'Executive Assessment Report (.docx)',
      subtitle: 'Microsoft Word Sizing & Readiness Document',
      description: 'Comprehensive assessment document containing sizing breakdown, column definitions, Fabric compatibility scores, and complexity classification.',
      status: 'Generated',
      badge: 'Assessment Docx',
      target: 'SQL_Server_Assessment_Report.docx',
      icon: 'bi-file-earmark-word-fill',
      accentColor: '#2563eb',
      actionLabel: 'Download Report (.docx)',
      actionIcon: 'bi-download'
    },
    {
      id: 'migration-plan-json',
      type: 'reports',
      title: 'Topological Migration Plan (.json)',
      subtitle: 'Normalized 5-Stage Dependency Batch Plan',
      description: 'Generated via plan_to_json.py — formats tables into 5 deterministic execution stages with FK topological sorting and rollback safeguards.',
      status: 'Validated',
      badge: 'JSON Plan',
      target: 'migration_plan.json',
      icon: 'bi-filetype-json',
      accentColor: '#10b981',
      actionLabel: 'Download Plan (.json)',
      actionIcon: 'bi-download'
    },
    {
      id: 'fabric-pipelines-ddl',
      type: 'pipelines',
      title: 'Fabric Data Factory Pipelines & T-SQL DDL',
      subtitle: 'Fabric Warehouse & Copy Activity Orchestration',
      description: 'Generates Fabric Data Pipeline copy activities and scripts T-SQL DDL for schema views, stored procedures, and tables via fabric_warehouse_sql.py.',
      status: 'Ready',
      badge: 'Fabric Data Factory',
      target: 'Fabric Data Pipeline · Copy Activities',
      icon: 'bi-bezier2',
      accentColor: '#ec4899',
      actionLabel: 'Inspect Pipeline DDL',
      actionIcon: 'bi-code-slash'
    }
  ];

  chatMessages: AgentChatMessage[] = [
    {
      id: 'msg-1',
      sender: 'agent',
      text: 'Welcome to the Phase 5 Artifacts Generator Agent. I synthesize the verified migration plan and provision Delta Parquet tables into Microsoft Fabric OneLake Lakehouses, compile the official Assessment Report (.docx), and serialize the 5-stage dependency batch plan into migration_plan.json.',
      timestamp: 'Just now',
      actions: [
        { label: 'Download Assessment Report (.docx)', actionId: 'download-docx', icon: 'bi-file-earmark-word-fill' },
        { label: 'Download migration_plan.json', actionId: 'download-json', icon: 'bi-filetype-json' },
        { label: 'Sync OneLake Delta Tables', actionId: 'sync-lakehouse', icon: 'bi-database-fill-check' }
      ]
    }
  ];

  get filteredDeliverables(): ArtifactDeliverable[] {
    if (this.activeCategory === 'all') return this.deliverables;
    return this.deliverables.filter(d => d.type === this.activeCategory);
  }

  setCategory(cat: 'all' | 'lakehouse' | 'reports' | 'pipelines'): void {
    this.activeCategory = cat;
  }

  sendMessage(textPrompt?: string): void {
    const text = (textPrompt || this.userInput || '').trim();
    if (!text) return;

    this.chatMessages.push({
      id: 'msg-' + Date.now(),
      sender: 'user',
      text,
      timestamp: 'Just now'
    });
    this.userInput = '';
    this.isProcessing = true;

    setTimeout(() => {
      this.isProcessing = false;
      const lower = text.toLowerCase();
      let responseText = '';
      let actions: { label: string; actionId: string; icon: string }[] | undefined = undefined;

      if (lower.includes('report') || lower.includes('docx')) {
        responseText = 'The official Assessment Report (.docx) has been compiled with table complexity scoring, sizing statistics, and Microsoft Fabric migration recommendations.';
        actions = [{ label: 'Download Report (.docx)', actionId: 'download-docx', icon: 'bi-download' }];
      } else if (lower.includes('json') || lower.includes('plan')) {
        responseText = 'The 5-stage dependency batch plan has been serialized into migration_plan.json with full foreign key topological sorting and load batch allocations.';
        actions = [{ label: 'Download migration_plan.json', actionId: 'download-json', icon: 'bi-download' }];
      } else if (lower.includes('lakehouse') || lower.includes('delta') || lower.includes('fabric')) {
        responseText = 'Microsoft Fabric OneLake Delta tables have been configured for SQL_Lakehouse. Delta Parquet files and metadata are ready for direct OneLake REST API ingestion.';
        actions = [{ label: 'Open Fabric OneLake', actionId: 'open-fabric', icon: 'bi-box-arrow-up-right' }];
      } else {
        responseText = `Acknowledged. I have reviewed your request regarding "${text}". All Layer 5 artifacts (OneLake Delta Tables, Assessment Report .docx, and migration_plan.json) are synchronized and ready.`;
      }

      this.chatMessages.push({
        id: 'msg-' + Date.now(),
        sender: 'agent',
        text: responseText,
        timestamp: 'Just now',
        actions
      });
    }, 700);
  }

  handleDeliverableAction(item: ArtifactDeliverable): void {
    if (item.id === 'assessment-report-docx') {
      this.triggerDownload('SQL_Server_Assessment_Report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } else if (item.id === 'migration-plan-json') {
      this.triggerDownload('migration_plan.json', 'application/json');
    } else if (item.id === 'fabric-lakehouse') {
      window.open('https://app.fabric.microsoft.com', '_blank');
    } else {
      this.sendMessage('Inspect Pipeline DDL');
    }
  }

  handleActionClick(actionId: string): void {
    if (actionId === 'download-docx') {
      this.triggerDownload('SQL_Server_Assessment_Report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } else if (actionId === 'download-json') {
      this.triggerDownload('migration_plan.json', 'application/json');
    } else if (actionId === 'sync-lakehouse' || actionId === 'open-fabric') {
      window.open('https://app.fabric.microsoft.com', '_blank');
    }
  }

  private triggerDownload(filename: string, mimeType: string): void {
    const dummyContent = filename.endsWith('.json')
      ? JSON.stringify({
          project: 'Apexon Azure Powered Migrator',
          phase: 'Phase 5 · OneLake Delta Tables & Reports',
          target_architecture: 'Microsoft Fabric Lakehouse (Delta Parquet)',
          stages: [
            { stage: 1, name: 'Reference & Lookup Tables', tables: ['dbo.ref_currencies', 'dbo.ref_status'] },
            { stage: 2, name: 'Core Master Entities', tables: ['dbo.dim_customer', 'dbo.dim_merchant'] },
            { stage: 3, name: 'Transaction Facts', tables: ['cards.transactions', 'dbo.fact_billing'] },
            { stage: 4, name: 'Historical Logs', tables: ['dbo.audit_events', 'dbo.sync_logs'] },
            { stage: 5, name: 'Views & Procedures', tables: ['dbo.vw_daily_settlement'] }
          ]
        }, null, 2)
      : 'Apexon Migration Platform Assessment Report - Ready for Microsoft Fabric Lakehouse Deployment.';

    const blob = new Blob([dummyContent], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }
}
