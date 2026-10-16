export type AgentExecutionStatus = 'idle' | 'running' | 'completed' | 'upcoming';

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
  status: 'live' | 'upcoming';
  executionStatus: AgentExecutionStatus;
  badgeText: string;
  description: string;
  route: string;
}
