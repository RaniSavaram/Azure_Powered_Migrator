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

  isDiscoveryRunning = false;

  get isDiscoveryDone(): boolean {
    return this.harnessDataService.isDiscoveryDone();
  }

  onStartDiscoveryConversation(): void {
    if (this.isDiscoveryDone) {
      this.router.navigate([this.discoveryAgent?.route || '/agents/discovery']);
      return;
    }
    this.isDiscoveryRunning = true;
    setTimeout(() => {
      this.harnessDataService.setDiscoveryConversationDone(true);
      this.isDiscoveryRunning = false;
    }, 600);
  }

  onViewDiscoveryResults(): void {
    if (!this.isDiscoveryDone) return;
    this.router.navigate(['/dbscanner']);
  }
}
