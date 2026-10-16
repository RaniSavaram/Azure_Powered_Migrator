import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-artifacts-generator',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './artifacts-generator.component.html',
  styleUrl: './artifacts-generator.component.css'
})
export class ArtifactsGeneratorComponent {
  agentName = 'Artifacts Generator';
  phase = 'Phase 7 · Asset Packaging & Deployment';

  onStartChat(): void {
    console.log('Artifacts Generator chat triggered');
  }
}
