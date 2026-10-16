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
  badgeText: string;
  description: string;
  route: string;
}
