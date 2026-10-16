import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-discovery-agent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './discovery-agent.component.html',
  styleUrl: './discovery-agent.component.css'
})
export class DiscoveryAgentComponent {
  agentName = 'Discovery Agent';
  phase = 'Phase 2 · Schema Intelligence';

  onStartChat(): void {
    console.log('Discovery Agent chat triggered');
  }
}
