import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-constraint-agent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './constraint-agent.component.html',
  styleUrl: './constraint-agent.component.css'
})
export class ConstraintAgentComponent {
  agentName = 'Constraint Agent';
  phase = 'Phase 1 · Constraint & Governance';

  // Placeholder for teammate to connect chatbot / execution logic
  onStartChat(): void {
    console.log('Constraint Agent chat triggered');
  }
}
