import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-evaluation-agent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './evaluation-agent.component.html',
  styleUrl: './evaluation-agent.component.css'
})
export class EvaluationAgentComponent {
  agentName = 'Evaluation Agent';
  phase = 'Evaluator-Generator Feedback Loop';
  nextPhaseRoute = '/agents/migration-generator';
  nextPhaseName = 'Migration Generator Agent';

  onStartChat(): void {
    console.log('Evaluation Agent chat triggered');
  }
}
