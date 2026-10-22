import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';

@Component({
  selector: 'app-discovery-agent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './discovery-agent.component.html',
  styleUrl: './discovery-agent.component.css'
})
export class DiscoveryAgentComponent {
  private harnessDataService = inject(HarnessDataService);

  agentName = 'Discovery Agent';
  phase = 'Phase 2 · Schema Intelligence';
  nextPhaseRoute = '/agents/assessment';
  nextPhaseName = 'Assessment Agent';

  get isChatCompleted(): boolean {
    return this.harnessDataService.isDiscoveryDone();
  }

  onFinishChat(): void {
    this.harnessDataService.setDiscoveryConversationDone(true);
  }

  onStartChat(): void {
    console.log('Discovery Agent chat triggered');
  }
}
