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
  /**
   * Directory in which to write guidance files for failed stories.
   * Guidance files are written as `guidance-<storyId>.md` when the user
   * exits discuss mode (e.g. `guidance/guidance-US-003.md`).
   * If empty, guidance is not persisted.
   */
  guidanceDir: string;
}

/**
 * Callbacks invoked when the user interacts with the post-run menu
 * (shown in summary view when there are failed stories).
 */
export interface PostRunCallbacks {
  /**
   * Called when the user presses 'd' to discuss a failed story.
   * Receives the storyId of the first failed story (or empty string if unavailable).
   */
  onDiscuss: (storyId: string) => void;
  /** Called when the user presses 'r' to retry all failed stories. */
  onRetry: () => void;
  /** Called when the user presses 'q' to quit after the run is complete. */
  onQuit: () => void;
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
  viewMode: 'dashboard' | 'logs' | 'epic-detail' | 'summary' | 'discuss';
  selectedEpicId: string | null;
  rawLogLines: string[];
  /** Merge events parsed from progress.txt (one per epic, latest state) */
  mergeEvents: MergeEvent[];
  /** True when all epics have reached a terminal state (completed/failed/partial/merge-failed) */
  runComplete: boolean;
  /**
   * Number of retry rounds completed so far (0 = first run, 1 = after first
   * retry, etc.). Incremented by the retry controller when a new round starts.
   * Used to display a "Retry #N" label in the summary view.
   */
  retryCount: number;
  /**
   * When true, the next numeric key press (1-9) should select an epic for detail view.
   * Set by pressing 'e', cleared after a digit is pressed or any other key.
   */
  awaitingEpicNumber: boolean;
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

/**
 * Result of one Builder→Validator cycle for a single user story.
 * Parsed from the progress.txt narrative logged by the Team Lead.
 */
export interface CycleResult {
  /** Attempt number (1-based): 1 = first attempt, 2 = retry */
  attempt: number;
  /** Overall result of this cycle: 'pass' = Validator accepted, 'fail' = rejected */
  result: 'pass' | 'fail';
  /** Short summary of what failed (from Validator feedback), or null if passed */
  failureDetail: string | null;
}

export interface StoryDisplayData {
  id: string;
  title: string;
  state: 'queued' | 'building' | 'validating' | 'pass' | 'fail';
  failureReason: string | null;
  duration: string | null;
  /**
   * Total number of build+validate cycles run for this story (1 or 2).
   * 0 means the story hasn't started yet or no cycle data is available.
   */
  attempts: number;
  /**
   * Per-cycle detail for completed cycles, ordered by attempt number.
   * Empty when no cycle data is available from progress.txt.
   */
  cycles: CycleResult[];
}

/** A merge event for a single epic, parsed from progress.txt. */
export interface MergeEvent {
  epicId: string;
  status: 'merging' | 'merged-clean' | 'merged-ai' | 'merge-failed';
  detail: string;
}

/**
 * A single message in the discuss conversation thread.
 *   - 'context': auto-generated system message shown at the top (failure summary)
 *   - 'user': guidance typed by the user
 *
 * Re-exported from views/discuss-view for convenience.
 */
export type { DiscussMessage } from './views/discuss-view';
