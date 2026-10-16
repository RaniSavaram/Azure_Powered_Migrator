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

  agents: AgentInfo[] = this.harnessDataService.getAgents();
  liveCount: number = this.harnessDataService.getLiveCount();
  upcomingCount: number = this.harnessDataService.getUpcomingCount();

  /**
   * Placeholder for teammate to attach Harness Layer working functionality.
   * Actions intentionally removed as requested.
   */
  onHarnessClick(agent: AgentInfo): void {
    // Teammate integration point: Add harness layer functionality here
  }

  /**
   * Placeholder for teammate to attach Chatbot working functionality.
   * Actions intentionally removed as requested.
   */
  onStartConversationClick(agent: AgentInfo): void {
    // Teammate integration point: Add working chatbot functionality here
  }
}
