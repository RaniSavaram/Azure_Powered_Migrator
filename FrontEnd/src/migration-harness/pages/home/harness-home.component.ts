import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
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

  agents$ = this.harnessDataService.agentsObservable$;
  liveCount: number = this.harnessDataService.getLiveCount();
  upcomingCount: number = this.harnessDataService.getUpcomingCount();
  pipelineState$ = this.harnessDataService.pipelineStateObservable$;
  activeRunningAgentId$ = this.harnessDataService.activeRunningAgentId$;

  startPipeline(): void {
    this.harnessDataService.startPipeline();
  }

  resetPipeline(): void {
    this.harnessDataService.resetPipeline();
  }

  onHarnessClick(agent: AgentInfo): void {
    // Teammate integration point: Add harness layer functionality here
  }

  onStartConversationClick(agent: AgentInfo): void {
    // Teammate integration point: Add working chatbot functionality here
  }
}
