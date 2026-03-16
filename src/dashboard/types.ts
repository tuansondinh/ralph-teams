/**
 * dashboard/types.ts — Shared types for the TUI dashboard.
 */

export interface DashboardOptions {
  /** Path to prd.json */
  prdPath: string;
  /** Path to ralph-run-stats.json */
  statsPath: string;
  /** Directory containing epic log files */
  logsDir: string;
  /** Path to progress.txt */
  progressPath: string;
  /** How frequently to poll data files in milliseconds (default: 1500) */
  pollIntervalMs: number;
}

export interface DashboardState {
  projectName: string;
  currentWave: number;
  startedAt: Date | null;
  epics: EpicDisplayData[];
  totalCostUsd: number | null;
  totalElapsed: string;
  viewMode: 'dashboard' | 'logs' | 'epic-detail';
  selectedEpicId: string | null;
  rawLogLines: string[];
}

export interface EpicDisplayData {
  id: string;
  title: string;
  status: string;
  storiesPassed: number;
  storiesTotal: number;
  stories: StoryDisplayData[];
  currentActivity: string;
  costActual: number | null;
  costEstimate: string | null;
  timeActual: string | null;
  timeEstimate: string | null;
  mergeStatus: string | null;
}

export interface StoryDisplayData {
  id: string;
  title: string;
  state: 'queued' | 'building' | 'validating' | 'pass' | 'fail';
  failureReason: string | null;
  duration: string | null;
}
