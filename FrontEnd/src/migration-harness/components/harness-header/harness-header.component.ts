import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';

@Component({
  selector: 'app-harness-header',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './harness-header.component.html',
  styleUrl: './harness-header.component.css'
})
export class HarnessHeaderComponent {
  private harnessDataService = inject(HarnessDataService);

  toggleSidebar(): void {
    this.harnessDataService.toggleSidebar();
  }
}
