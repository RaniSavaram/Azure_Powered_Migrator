import { Routes } from '@angular/router';

import { HarnessLayoutComponent } from '../migration-harness/layouts/harness-layout.component';
import { HarnessHomeComponent } from '../migration-harness/pages/home/harness-home.component';

// 7 Dedicated Agent Components
import { ConstraintAgentComponent } from '../migration-harness/agents/constraint-agent/constraint-agent.component';
import { DiscoveryAgentComponent } from '../migration-harness/agents/discovery-agent/discovery-agent.component';
import { AssessmentAgentComponent } from '../migration-harness/agents/assessment-agent/assessment-agent.component';
import { EvaluationAgentComponent } from '../migration-harness/agents/evaluation-agent/evaluation-agent.component';
import { MigrationGeneratorAgentComponent } from '../migration-harness/agents/migration-generator-agent/migration-generator-agent.component';
import { MedallionGenerationAgentComponent } from '../migration-harness/agents/medallion-generation-agent/medallion-generation-agent.component';
import { ArtifactsGeneratorComponent } from '../migration-harness/agents/artifacts-generator/artifacts-generator.component';

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
      // 7 Dedicated Agent Routes
      {
        path: 'agents/constraint',
        component: ConstraintAgentComponent
      },
      {
        path: 'agents/discovery',
        component: DiscoveryAgentComponent
      },
      {
        path: 'agents/assessment',
        component: AssessmentAgentComponent
      },
      {
        path: 'agents/evaluation',
        component: EvaluationAgentComponent
      },
      {
        path: 'agents/migration-generator',
        component: MigrationGeneratorAgentComponent
      },
      {
        path: 'agents/medallion-generation',
        component: MedallionGenerationAgentComponent
      },
      {
        path: 'agents/artifacts-generator',
        component: ArtifactsGeneratorComponent
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