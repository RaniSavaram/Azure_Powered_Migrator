import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';

@Component({
  selector: 'app-evaluation-agent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './evaluation-agent.component.html',
  styleUrl: './evaluation-agent.component.css'
})
export class EvaluationAgentComponent {
  private harnessDataService = inject(HarnessDataService);

  agentName = 'Evaluation Agent';
  phase = 'Evaluator-Generator Feedback Loop';
  nextPhaseRoute = '/agents/migration-generator';
  nextPhaseName = 'Migration Generator Agent';

  get isSourceConnected(): boolean {
    return this.harnessDataService.isSourceConnected();
  }

  onStartChat(): void {
    console.log('Evaluation Agent chat triggered');
  }
}

