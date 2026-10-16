export interface HarnessCheck {
  name: string;
  completed_name: string;
  rule: string;
  status: 'passed' | 'warning' | 'info';
  info_text?: string;
}

export interface AgentInfo {
  id: string;
  phase: number;
  name: string;
  sidebarName: string;
  sidebarSubtext: string;
  phaseTag: string;
  category: string;
  color: string;
  accentBorder: string;
  bgTint: string;
  icon: string;
  status: 'live' | 'coming_soon';
  badgeText: string;
  description: string;
  harnessLayerTitle: string;
  harnessLayerType: 'layer1' | 'layer2' | 'layer3';
  harnessDescription: string;
  harnessChecks: HarnessCheck[];
  sampleLogs: string[];
  capabilities: string[];
}
