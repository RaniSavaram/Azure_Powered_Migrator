import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
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
  selectedAgentId$ = this.harnessDataService.selectedAgentIdObservable$;

  constructor() {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      const url = event.urlAfterRedirects || event.url;
      this.syncActiveAgentWithUrl(url);
    });
    this.syncActiveAgentWithUrl(this.router.url);
  }

  private syncActiveAgentWithUrl(rawUrl: string): void {
    const cleanUrl = (rawUrl || '').split('?')[0].split('#')[0];
    const agents = this.harnessDataService.getAgents();
    const matched = agents.find(a => a.status !== 'upcoming' && (cleanUrl === a.route || cleanUrl.startsWith(a.route + '/')));
    if (matched) {
      this.harnessDataService.setSelectedAgent(matched.id);
    } else if (cleanUrl === '/' || cleanUrl === '') {
      this.harnessDataService.setSelectedAgent(null);
    }
  }

  isAgentActive(agent: AgentInfo): boolean {
    if (agent.status === 'upcoming') return false;
    const selectedId = this.harnessDataService.getSelectedAgentId();
    if (selectedId && selectedId === agent.id) return true;
    const url = this.router.url.split('?')[0].split('#')[0];
    return url === agent.route || url.startsWith(agent.route + '/');
  }

  isAgentRunning(agent: AgentInfo): boolean {
    if (agent.status === 'upcoming') return false;
    const runningId = this.harnessDataService.getActiveRunningAgentId();
    return agent.executionStatus === 'running' || runningId === agent.id;
  }

  onAgentClick(agent: AgentInfo): void {
    if (agent.status === 'upcoming') return;
    this.harnessDataService.setSelectedAgent(agent.id);
  }
}
