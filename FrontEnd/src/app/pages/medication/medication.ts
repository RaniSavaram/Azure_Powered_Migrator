import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-medication',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './medication.html',
  styleUrl: './medication.css'
})
export class MedicationComponent {

  pptUrl =
    'https://isplahd-my.sharepoint.com/:p:/g/personal/rani_savaram_apexon_com/IQBF4F-DkmKdRLz4wlGDis5VASUOYpXkCo1nRQhRsYJDCNg?wdExp=TEAMS-TREATMENT&web=1&TeamsCID=9e0c9148-e3d0-4a51-b143-0a6239edd33b';

  demoUrl = 'https://medication-adherence-dashboard.onrender.com/';

  videoUrl = 'https://ranisavaram.github.io/Medication-Adherence/';

  viewPPT() {
    window.open(this.pptUrl, '_blank');
  }

  viewDemo() {
    window.open(this.demoUrl, '_blank');
  }

  viewVideo() {
    window.open(this.videoUrl, '_blank');
  }

}