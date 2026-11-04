import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';
import { AgentInfo } from '../../models/agent.model';
import { ResultsDialogComponent } from '../../components/results-dialog/results-dialog.component';
import { FabricDestinationDialogComponent } from '../../components/fabric-destination-dialog/fabric-destination-dialog.component';

const ARTIFACTS_GENERATOR_ID = 'artifacts-generator';

@Component({
  selector: 'app-harness-home',
  standalone: true,
  imports: [CommonModule, RouterModule, ResultsDialogComponent, FabricDestinationDialogComponent],
  templateUrl: './harness-home.component.html',
  styleUrl: './harness-home.component.css'
})
export class HarnessHomeComponent {
  private harnessDataService = inject(HarnessDataService);
  private router = inject(Router);

  agents$ = this.harnessDataService.agentsObservable$;
  liveCount: number = this.harnessDataService.getLiveCount();
  upcomingCount: number = this.harnessDataService.getUpcomingCount();

  constraintAgent = this.harnessDataService.getAgentById('constraint-agent');
  discoveryAgent = this.harnessDataService.getAgentById('discovery-agent');
  assessmentAgent = this.harnessDataService.getAgentById('assessment-agent');
  evaluationAgent = this.harnessDataService.getAgentById('evaluation-agent');
  migrationAgent = this.harnessDataService.getAgentById('migration-generator-agent');
  artifactsAgent = this.harnessDataService.getAgentById('artifacts-generator');
  medallionAgent = this.harnessDataService.getAgentById('medallion-generation-agent');

  get isSourceConnected(): boolean {
    return this.harnessDataService.isSourceConnected();
  }

  showStartPhase1Modal = false;
  showResultsDialog = false;

  openStartPhase1Modal(): void {
    this.showStartPhase1Modal = true;
  }

  closeStartPhase1Modal(): void {
    this.showStartPhase1Modal = false;
  }

  confirmStartPhase1(): void {
    this.showStartPhase1Modal = false;
    this.router.navigate(['/agents/discovery']);
  }

  openResultsDialog(): void {
    this.showResultsDialog = true;
  }

  closeResultsDialog(): void {
    this.showResultsDialog = false;
  }

  /** Agent waiting on the Fabric destination dialog before its conversation starts. */
  pendingDestinationAgent = signal<AgentInfo | null>(null);

  onHarnessClick(agent: AgentInfo): void {
    if (agent.status === 'upcoming') return;
    // Teammate integration point: Add harness layer functionality here
  }

  onStartConversationClick(agent: AgentInfo): void {
    if (agent.status === 'upcoming') return;
    // The Artifacts Generator needs to know which Fabric workspace /
    // Lakehouse / Warehouse to deploy into before it can start.
    if (agent.id === ARTIFACTS_GENERATOR_ID) {
      this.pendingDestinationAgent.set(agent);
      return;
    }
    this.harnessDataService.startPipelineFrom(agent.id);
  }

  onDestinationConnected(): void {
    const agent = this.pendingDestinationAgent();
    this.pendingDestinationAgent.set(null);
    if (agent) this.harnessDataService.startPipelineFrom(agent.id);
  }

  onDestinationCancelled(): void {
    this.pendingDestinationAgent.set(null);
  }
}
