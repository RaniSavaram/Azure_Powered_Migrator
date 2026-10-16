import { Routes } from '@angular/router';

import { HarnessLayoutComponent } from '../migration-harness/layouts/harness-layout.component';
import { HarnessHomeComponent } from '../migration-harness/pages/home/harness-home.component';
import { AgentDetailComponent } from '../migration-harness/pages/agent-detail/agent-detail.component';

import { MainLayoutComponent } from './layouts/main-layout/main-layout';
import { HomeComponent } from './pages/home/home';
import { DbScannerComponent } from './pages/db-scanner/db-scanner';
import { BiMigratorComponent } from './pages/bi-migrator/bi-migrator';
import { MedicationComponent } from './pages/medication/medication';

export const routes: Routes = [
  {
    path: '',
    component: HarnessLayoutComponent,
    children: [
      {
        path: '',
        component: HarnessHomeComponent
      },
      {
        path: 'agent/:id',
        component: AgentDetailComponent
      },
      {
        path: 'dbscanner',
        component: DbScannerComponent
      },
      {
        path: 'bimigrator',
        component: BiMigratorComponent
      },
      {
        path: 'medication',
        component: MedicationComponent
      }
    ]
  },
  {
    path: 'classic',
    component: MainLayoutComponent,
    children: [
      {
        path: '',
        component: HomeComponent
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];