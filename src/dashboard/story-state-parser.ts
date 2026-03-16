/**
 * dashboard/story-state-parser.ts — Pure functions to determine story state
 * from available data sources (prd.json, ralph-run-stats.json, progress.txt).
 *
 * All functions are pure and have no I/O side-effects, making them easy to
 * unit-test without a filesystem.
 */

/** Five possible story states shown in the dashboard. */
export type StoryState = 'queued' | 'building' | 'validating' | 'pass' | 'fail';

/**
 * Input bundle for determining the state of a single user story.
 * All fields come from already-parsed data (not raw file paths).
 */
export interface StoryStateInput {
  /** Story ID, e.g. "US-003" */
  storyId: string;
  /** Parent epic ID, e.g. "EPIC-001" */
  epicId: string;
  /** passes field from prd.json */
  passes: boolean;
  /** True when the story has any entry in ralph-run-stats.json */
  hasStatsEntry: boolean;
  /** True when completedAt is set in the stats entry */
  statsCompleted: boolean;
  /** passed field from the stats entry */
  statsPassed: boolean;
  /** durationFormatted from stats, e.g. "2m 12s" — null if not yet set */
  statsDuration: string | null;
  /**
   * Relevant lines from progress.txt that mention this story ID.
   * The poller pre-filters these before calling determineStoryState.
   */
  progressLines: string[];
}

/** Output from determineStoryState. */
export interface StoryStateResult {
  state: StoryState;
  /** Human-readable reason for a failure, or null for non-fail states. */
  failureReason: string | null;
  /** Human-readable wall-clock duration, e.g. "2m 12s", or null. */
  duration: string | null;
}

/**
 * Extracts a failure reason from a progress.txt line that contains "FAIL".
 *
 * Looks for text after "FAIL:" (case-insensitive). If no colon, returns null.
 *
 * @example
 * extractFailureReason("US-003 FAIL: typecheck passes not met")
 * // => "typecheck passes not met"
 */
export function extractFailureReason(line: string): string | null {
  // Match "FAIL:" followed by optional whitespace and capture the rest
  const match = /FAIL:\s*(.+)/i.exec(line);
  if (!match) return null;
  return match[1].trim() || null;
}

/**
 * Returns true if any progress line for this story contains a FAIL signal.
 * Matches "FAIL" or "FAILED" (word boundary on the left only, to also catch "FAILED").
 */
export function hasFailSignalInProgress(progressLines: string[]): boolean {
  return progressLines.some(line => /\bFAIL/i.test(line));
}

/**
 * Returns true if any progress line for this story contains a validating signal.
 * Looks for keywords like "validat" in the line.
 */
export function hasValidatingSignalInProgress(progressLines: string[]): boolean {
  return progressLines.some(line => /validat/i.test(line));
}

/**
 * Returns true if any progress line contains a building signal.
 * Looks for keywords like "building", "build", "implementing", "starting".
 */
export function hasBuildingSignalInProgress(progressLines: string[]): boolean {
  return progressLines.some(line => /\b(building|build|implementing|starting)\b/i.test(line));
}

/**
 * Determines the display state of a single user story from available data.
 *
 * Decision tree (in priority order):
 * 1. passes === true AND statsCompleted === true  → 'pass' (confirmed)
 * 2. passes === true (stats not yet confirmed)    → 'pass' (prd is authoritative)
 * 3. statsCompleted === true AND statsPassed === false → 'fail' (from stats)
 * 4. Progress lines contain a FAIL pattern        → 'fail' (from progress log)
 * 5. hasStatsEntry AND hasValidatingSignal        → 'validating'
 * 6. hasStatsEntry AND hasBuildingSignal          → 'building'
 * 7. hasStatsEntry (started, no other signal)     → 'building'
 * 8. Otherwise                                    → 'queued'
 */
export function determineStoryState(input: StoryStateInput): StoryStateResult {
  const { passes, hasStatsEntry, statsCompleted, statsPassed, statsDuration, progressLines } = input;

  // Rule 1 & 2: passes === true in prd.json is authoritative for pass
  if (passes) {
    return {
      state: 'pass',
      failureReason: null,
      duration: statsDuration,
    };
  }

  // Rule 3: stats says completed and failed
  if (statsCompleted && !statsPassed) {
    // Try to find a reason from progress lines
    let failureReason: string | null = null;
    for (const line of progressLines) {
      const reason = extractFailureReason(line);
      if (reason) {
        failureReason = reason;
        break;
      }
    }
    return {
      state: 'fail',
      failureReason,
      duration: statsDuration,
    };
  }

  // Rule 4: progress lines contain a FAIL signal (before stats is written)
  if (hasFailSignalInProgress(progressLines)) {
    let failureReason: string | null = null;
    for (const line of progressLines) {
      const reason = extractFailureReason(line);
      if (reason) {
        failureReason = reason;
        break;
      }
    }
    return {
      state: 'fail',
      failureReason,
      duration: statsDuration,
    };
  }

  // Rule 5: story has started and there are validating signals
  if (hasStatsEntry && hasValidatingSignalInProgress(progressLines)) {
    return { state: 'validating', failureReason: null, duration: null };
  }

  // Rule 6 & 7: story has started (has a stats entry, or building signals in progress)
  if (hasStatsEntry || hasBuildingSignalInProgress(progressLines)) {
    return { state: 'building', failureReason: null, duration: null };
  }

  // Rule 8: default — nothing known yet
  return { state: 'queued', failureReason: null, duration: null };
}

/**
 * Extracts story-relevant lines from progress.txt content.
 *
 * Matches lines that contain the storyId (e.g., "US-003") or epicId
 * followed by story-level context. Returns all matching lines.
 *
 * @param progressContent - Full progress.txt content
 * @param storyId - Story ID to filter for, e.g. "US-003"
 * @param epicId - Parent epic ID, e.g. "EPIC-001"
 */
export function filterProgressLinesForStory(
  progressContent: string,
  storyId: string,
  epicId: string,
): string[] {
  if (!progressContent) return [];
  const lines = progressContent.split('\n');
  // Match lines containing the story ID directly
  return lines.filter(line => line.includes(storyId) || line.includes(`[${epicId}]`));
}
