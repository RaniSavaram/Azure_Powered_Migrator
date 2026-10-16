import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { HarnessHeaderComponent } from '../components/harness-header/harness-header.component';
import { HarnessSidebarComponent } from '../components/harness-sidebar/harness-sidebar.component';

@Component({
  selector: 'app-harness-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    HarnessHeaderComponent,
    HarnessSidebarComponent
  ],
  templateUrl: './harness-layout.component.html',
  styleUrl: './harness-layout.component.css'
})
export class HarnessLayoutComponent {}
