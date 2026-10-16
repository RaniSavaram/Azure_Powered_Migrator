import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { HarnessDataService } from '../../services/harness-data.service';
import { AgentInfo } from '../../models/agent.model';

@Component({
  selector: 'app-agent-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './agent-detail.component.html',
  styleUrl: './agent-detail.component.css'
})
export class AgentDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private harnessDataService = inject(HarnessDataService);

  agent?: AgentInfo;
  activeConsoleTab: 'overview' | 'harness' | 'telemetry' = 'overview';
  isRunning = false;
  executionComplete = false;

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.agent = this.harnessDataService.getAgentById(id);
      }
    });
  }

  openHarnessModal(): void {
    if (this.agent) {
      this.harnessDataService.openHarnessModal(this.agent);
    }
  }

  runAgentExecution(): void {
    if (!this.agent) return;
    this.isRunning = true;
    this.executionComplete = false;
    setTimeout(() => {
      this.isRunning = false;
      this.executionComplete = true;
      this.agent?.sampleLogs.push(`[EXECUTION COMPLETED] ${new Date().toLocaleTimeString()} ${this.agent.name} completed successfully with 100% deterministic score.`);
    }, 1800);
  }

  openScanner(): void {
    this.router.navigate(['/dbscanner']);
  }
}
