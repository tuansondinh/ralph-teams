/**
 * dashboard/views/summary-view.ts — Final run summary view.
 *
 * Renders a post-run summary screen showing overall pass/fail counts,
 * failed story details, total cost, and total elapsed time.
 * Pure rendering module — no blessed dependencies.
 */

import { DashboardState } from '../types';

/** Details of a single failed user story. */
export interface FailedStoryDetail {
  storyId: string;
  storyTitle: string;
  epicId: string;
  epicTitle: string;
  failureReason: string | null;
}

/** Aggregated summary of a completed run. */
export interface RunSummary {
  totalEpics: number;
  completedEpics: number;
  failedEpics: number;
  partialEpics: number;
  totalStories: number;
  passedStories: number;
  failedStories: number;
  /** Details for each story that ended in a 'fail' state. */
  failedStoryDetails: FailedStoryDetail[];
  /** Total cost across all epics in USD, or null if unavailable. */
  totalCost: number | null;
  /** Total elapsed time string (e.g. '12m 30s'), or '--' if unavailable. */
  totalElapsed: string;
}

/**
 * Computes an aggregated RunSummary from the current DashboardState.
 *
 * @param state - Current DashboardState (should have runComplete: true)
 */
export function computeRunSummary(state: DashboardState): RunSummary {
  let totalStories = 0;
  let passedStories = 0;
  let failedStories = 0;
  let completedEpics = 0;
  let failedEpics = 0;
  let partialEpics = 0;
  const failedStoryDetails: FailedStoryDetail[] = [];

  for (const epic of state.epics) {
    switch (epic.status) {
      case 'completed':
        completedEpics++;
        break;
      case 'failed':
      case 'merge-failed':
        failedEpics++;
        break;
      case 'partial':
        partialEpics++;
        break;
      default:
        break;
    }

    for (const story of epic.stories) {
      totalStories++;
      if (story.state === 'pass') {
        passedStories++;
      } else if (story.state === 'fail') {
        failedStories++;
        failedStoryDetails.push({
          storyId: story.id,
          storyTitle: story.title,
          epicId: epic.id,
          epicTitle: epic.title,
          failureReason: story.failureReason,
        });
      }
    }
  }

  return {
    totalEpics: state.epics.length,
    completedEpics,
    failedEpics,
    partialEpics,
    totalStories,
    passedStories,
    failedStories,
    failedStoryDetails,
    totalCost: state.totalCostUsd,
    totalElapsed: state.totalElapsed,
  };
}

/**
 * Renders the final run summary screen as a multi-line string.
 *
 * Layout:
 *   [Run Complete]
 *   ────────────────────────────────────────────
 *   Run Summary
 *   Epics:   3 total  |  2 completed  |  0 failed  |  1 partial
 *   Stories: 10 total  |  8 passed  |  2 failed
 *   Cost:    $1.23  |  Time: 12m 30s
 *   ────────────────────────────────────────────
 *   Failed Stories:
 *     x EPIC-001 (Foundation Epic) — US-002: My Story — reason: typecheck error
 *   (or "(none)" if all stories passed)
 *
 *   [d] discuss a story  [r] retry all failed  [q] quit
 *   (or "All stories passed! Press q to exit." when no failures)
 *
 * @param summary - Computed RunSummary
 * @param hasFailures - When true, shows the interactive post-run menu; when false (default), shows all-passed message
 */
export function renderSummaryView(summary: RunSummary, hasFailures: boolean = false): string {
  const sep = '─'.repeat(72);

  const costStr = summary.totalCost !== null
    ? `$${summary.totalCost.toFixed(2)}`
    : '--';

  const lines: string[] = [
    '[Run Complete]',
    '',
    'Run Summary',
    sep,
    `  Epics:   ${summary.totalEpics} total  |  ${summary.completedEpics} completed  |  ${summary.failedEpics} failed  |  ${summary.partialEpics} partial`,
    `  Stories: ${summary.totalStories} total  |  ${summary.passedStories} passed  |  ${summary.failedStories} failed`,
    `  Cost:    ${costStr}  |  Time: ${summary.totalElapsed}`,
    sep,
    '  Failed Stories:',
  ];

  if (summary.failedStoryDetails.length === 0) {
    lines.push('    (none)');
  } else {
    for (const detail of summary.failedStoryDetails) {
      const reasonStr = detail.failureReason ? ` — reason: ${detail.failureReason}` : '';
      lines.push(`    x ${detail.epicId} (${detail.epicTitle}) — ${detail.storyId}: ${detail.storyTitle}${reasonStr}`);
    }
  }

  lines.push('');
  if (hasFailures) {
    lines.push('  [d] discuss a story  [r] retry all failed  [q] quit');
  } else {
    lines.push('  All stories passed! press q to quit');
  }

  return lines.join('\n');
}
