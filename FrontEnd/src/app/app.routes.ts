import { Routes } from '@angular/router';

import { HarnessLayoutComponent } from '../migration-harness/layouts/harness-layout.component';
import { HarnessHomeComponent } from '../migration-harness/pages/home/harness-home.component';

// Other POCs & Classic views
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
      // 7 Dedicated Agent Routes (Lazy Loaded)
      {
        path: 'agents/constraint',
        loadComponent: () => import('../migration-harness/agents/constraint-agent/constraint-agent.component').then(m => m.ConstraintAgentComponent)
      },
      {
        path: 'agents/discovery',
        loadComponent: () => import('../migration-harness/agents/discovery-agent/discovery-agent.component').then(m => m.DiscoveryAgentComponent)
      },
      {
        path: 'agents/assessment',
        loadComponent: () => import('../migration-harness/agents/assessment-agent/assessment-agent.component').then(m => m.AssessmentAgentComponent)
      },
      {
        path: 'agents/evaluation',
        loadComponent: () => import('../migration-harness/agents/evaluation-agent/evaluation-agent.component').then(m => m.EvaluationAgentComponent)
      },
      {
        path: 'agents/migration-generator',
        loadComponent: () => import('../migration-harness/agents/migration-generator-agent/migration-generator-agent.component').then(m => m.MigrationGeneratorAgentComponent)
      },
      {
        path: 'agents/medallion-generation',
        loadComponent: () => import('../migration-harness/agents/medallion-generation-agent/medallion-generation-agent.component').then(m => m.MedallionGenerationAgentComponent)
      },
      {
        path: 'agents/artifacts-generator',
        loadComponent: () => import('../migration-harness/agents/artifacts-generator/artifacts-generator.component').then(m => m.ArtifactsGeneratorComponent)
      },
      // Other POCs
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