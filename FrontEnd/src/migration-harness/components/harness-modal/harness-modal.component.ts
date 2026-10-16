import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HarnessDataService } from '../../services/harness-data.service';
import { AgentInfo } from '../../models/agent.model';

@Component({
  selector: 'app-harness-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './harness-modal.component.html',
  styleUrl: './harness-modal.component.css'
})
export class HarnessModalComponent {
  private harnessDataService = inject(HarnessDataService);
  private router = inject(Router);

  activeAgent$ = this.harnessDataService.activeAgentForModal$;
  userFeedback = '';
  feedbackSubmitted = false;
  isSimulatingTest = false;
  testPassed = false;

  close(): void {
    this.harnessDataService.closeHarnessModal();
    this.userFeedback = '';
    this.feedbackSubmitted = false;
    this.isSimulatingTest = false;
    this.testPassed = false;
  }

  submitFeedback(agent: AgentInfo): void {
    if (!this.userFeedback.trim()) return;
    this.feedbackSubmitted = true;
    agent.sampleLogs.push(`[FEEDBACK RECORDED] ${new Date().toLocaleTimeString()} User: ${this.userFeedback}`);
    setTimeout(() => {
      this.feedbackSubmitted = false;
      this.userFeedback = '';
    }, 2500);
  }

  runHarnessTest(agent: AgentInfo): void {
    this.isSimulatingTest = true;
    this.testPassed = false;
    setTimeout(() => {
      this.isSimulatingTest = false;
      this.testPassed = true;
      agent.sampleLogs.push(`[HARNESS TEST SUCCESS] ${new Date().toLocaleTimeString()} All ${agent.harnessChecks.length} checks re-verified against ground truth.`);
    }, 1200);
  }

  openAgentDetail(agent: AgentInfo): void {
    this.close();
    this.router.navigate(['/agent', agent.id]);
  }
}
