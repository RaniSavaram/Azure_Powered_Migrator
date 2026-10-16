import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-migration-generator-agent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './migration-generator-agent.component.html',
  styleUrl: './migration-generator-agent.component.css'
})
export class MigrationGeneratorAgentComponent {
  agentName = 'Migration Generator Agent';
  phase = 'Phase 5 · Code & Pipeline Generation';

  onStartChat(): void {
    console.log('Migration Generator Agent chat triggered');
  }
}
