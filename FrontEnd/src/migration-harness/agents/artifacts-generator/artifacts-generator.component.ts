import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';

@Component({
  selector: 'app-artifacts-generator',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './artifacts-generator.component.html',
  styleUrl: './artifacts-generator.component.css'
})
export class ArtifactsGeneratorComponent {
  private harnessDataService = inject(HarnessDataService);

  agentName = 'Artifacts Generator';
  phase = 'Phase 5 · OneLake Delta Tables & Reports';
  nextPhaseRoute = '/';
  nextPhaseName = 'Dashboard';

  get isSourceConnected(): boolean {
    return this.harnessDataService.isSourceConnected();
  }

  onStartChat(): void {
    console.log('Artifacts Generator chat triggered');
  }
}

