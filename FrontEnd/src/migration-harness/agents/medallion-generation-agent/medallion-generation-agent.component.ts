import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-medallion-generation-agent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './medallion-generation-agent.component.html',
  styleUrl: './medallion-generation-agent.component.css'
})
export class MedallionGenerationAgentComponent {
  agentName = 'Medallion Generation Agent';
  phase = 'Phase 6 · Lakehouse Architecture (Upcoming)';

  onStartChat(): void {
    console.log('Medallion Generation Agent chat triggered');
  }
}
