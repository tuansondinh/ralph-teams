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
  /** Estimated total cost string from run stats, e.g. '$1.23' or '--' */
  totalCostEstimate: string | null;
  totalElapsed: string;
  /** Estimated total time string from run stats, e.g. '12m 30s' or '--' */
  totalTimeEstimate: string | null;
  viewMode: 'dashboard' | 'logs' | 'epic-detail';
  selectedEpicId: string | null;
  rawLogLines: string[];
  /** Merge events parsed from progress.txt (one per epic, latest state) */
  mergeEvents: MergeEvent[];
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

/** A merge event for a single epic, parsed from progress.txt. */
export interface MergeEvent {
  epicId: string;
  status: 'merging' | 'merged-clean' | 'merged-ai' | 'merge-failed';
  detail: string;
}
