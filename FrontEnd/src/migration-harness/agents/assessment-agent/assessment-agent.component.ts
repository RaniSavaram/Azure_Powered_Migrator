import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-assessment-agent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './assessment-agent.component.html',
  styleUrl: './assessment-agent.component.css'
})
export class AssessmentAgentComponent {
  agentName = 'Assessment Agent';
  phase = 'Phase 3 · Migration Readiness & Sizing';

  onStartChat(): void {
    console.log('Assessment Agent chat triggered');
  }
}
