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

  agents: AgentInfo[] = this.harnessDataService.getAgents();

  openHarnessLayer(agent: AgentInfo, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.harnessDataService.openHarnessModal(agent);
  }

  startConversation(agent: AgentInfo, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (agent.id === 'discovery-agent') {
      // Direct navigation to DB Scanner for discovery workflows
      this.router.navigate(['/dbscanner']);
    } else {
      this.router.navigate(['/agent', agent.id]);
    }
  }
}
