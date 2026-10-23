import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';
import { AgentInfo } from '../../models/agent.model';

@Component({
  selector: 'app-harness-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './harness-sidebar.component.html',
  styleUrl: './harness-sidebar.component.css'
})
export class HarnessSidebarComponent {
  private harnessDataService = inject(HarnessDataService);
  private router = inject(Router);
  
  agents$ = this.harnessDataService.agentsObservable$;
  liveCount: number = this.harnessDataService.getLiveCount();
  isCollapsed$ = this.harnessDataService.sidebarCollapsed$;
  activeRunningAgentId$ = this.harnessDataService.activeRunningAgentId$;

  isAgentActive(agent: AgentInfo): boolean {
    if (agent.status === 'upcoming') return false;
    const url = this.router.url.split('?')[0].split('#')[0];
    return url === agent.route || url.startsWith(agent.route + '/');
  }

  isAgentRunning(agent: AgentInfo): boolean {
    if (agent.status === 'upcoming') return false;
    const runningId = this.harnessDataService.getActiveRunningAgentId();
    return agent.executionStatus === 'running' || runningId === agent.id;
  }
}
