import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
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
  
  agents: AgentInfo[] = this.harnessDataService.getAgents();
  isCollapsed$ = this.harnessDataService.sidebarCollapsed$;

  openHarness(agent: AgentInfo, event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.harnessDataService.openHarnessModal(agent);
  }
}
