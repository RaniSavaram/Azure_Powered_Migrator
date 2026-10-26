import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';
import { AgentInfo } from '../../models/agent.model';

@Component({
  selector: 'app-harness-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
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
}
