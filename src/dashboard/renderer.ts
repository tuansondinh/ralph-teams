/**
 * dashboard/renderer.ts — Pure rendering functions for the TUI dashboard.
 *
 * All functions here are pure (no blessed dependencies) so they can be
 * unit-tested without a terminal.
 */

import { DashboardState, EpicDisplayData, StoryDisplayData } from './types';

/**
 * Returns a progress bar string like `[####----] 3/5`.
 *
 * @param passed - Number of passed stories
 * @param total - Total number of stories
 * @param width - Total number of fill characters (default: 10)
 */
export function formatProgressBar(passed: number, total: number, width: number = 10): string {
  if (total === 0) {
    return `[${''.padEnd(width, '-')}] 0/0`;
  }
  const ratio = Math.min(passed / total, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `[${'#'.repeat(filled)}${'-'.repeat(empty)}] ${passed}/${total}`;
}

/**
 * Formats a cost value as a dollar string, or returns '--' if null.
 */
export function formatCost(costUsd: number | null): string {
  if (costUsd === null) return '--';
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Returns a status symbol for an epic status string.
 */
export function epicStatusSymbol(status: string): string {
  switch (status) {
    case 'completed': return '[DONE]';
    case 'failed':    return '[FAIL]';
    case 'merge-failed': return '[MRG!]';
    case 'partial':   return '[PART]';
    default:          return '[    ]';
  }
}

/**
 * Formats the header content for the dashboard.
 * Returns an array of lines to display in the header box.
 *
 * When estimates are available, a second cost line shows actual vs. estimated total.
 */
export function renderHeader(state: DashboardState): string[] {
  const project = state.projectName || '(no project)';
  const wave = state.currentWave > 0 ? `Wave ${state.currentWave}` : 'Wave --';
  const elapsed = state.totalElapsed || '--';

  const costActual = state.totalCostUsd !== null
    ? `$${state.totalCostUsd.toFixed(2)}`
    : '--';

  const costEstimate = state.totalCostEstimate ?? null;
  const timeEstimate = state.totalTimeEstimate ?? null;

  const lines: string[] = [
    `Ralph Teams — ${project}`,
    `${wave}  |  Elapsed: ${elapsed}  |  Cost: ${costActual}`,
  ];

  // Show estimates line when at least one estimate is available
  if (costEstimate !== null || timeEstimate !== null) {
    const costPart = costEstimate ? `Est. total: ${costEstimate}` : null;
    const timePart = timeEstimate ? `Est. time: ${timeEstimate}` : null;
    const parts = [costPart, timePart].filter((p): p is string => p !== null);
    lines.push(parts.join('  |  '));
  }

  return lines;
}

/**
 * Formats a single epic row for the epic list box.
 * Shows actual cost/time when available, with estimate in parens for incomplete epics.
 * Returns the formatted string representation.
 */
export function renderEpicRow(epic: EpicDisplayData): string {
  const bar = formatProgressBar(epic.storiesPassed, epic.storiesTotal);
  const status = epicStatusSymbol(epic.status);

  // Cost: show actual, or estimate if no actual yet
  let costStr: string;
  if (epic.costActual !== null) {
    costStr = formatCost(epic.costActual);
    if (epic.costEstimate !== null) {
      costStr += ` (est:${epic.costEstimate})`;
    }
  } else {
    costStr = epic.costEstimate ?? '--';
  }

  // Time: show actual, or estimate if no actual yet
  const timeStr = epic.timeActual ?? (epic.timeEstimate ?? '--');

  // Merge status suffix
  const mergeSuffix = epic.mergeStatus ? `  [merge:${epic.mergeStatus}]` : '';

  return `${status} ${epic.id}: ${epic.title.substring(0, 28).padEnd(28)} ${bar}  cost:${costStr}  time:${timeStr}${mergeSuffix}`;
}

/**
 * Renders a merge status line for an epic that has a merge event.
 * Returns null if there is no merge event for this epic.
 *
 * Format: `    merge: done (clean)` or `    merge: FAILED — src/api.ts src/utils.ts`
 *
 * @param epic - EpicDisplayData with optional mergeStatus
 * @param mergeEvents - All merge events from progress.txt
 */
export function renderMergeStatusLine(
  epic: EpicDisplayData,
  mergeEvents: Array<{ epicId: string; status: string; detail: string }>,
): string | null {
  const event = mergeEvents.find(e => e.epicId === epic.id);
  if (!event) return null;

  switch (event.status) {
    case 'merging':      return `    merge: resolving conflicts...`;
    case 'merged-clean': return `    merge: done (clean)`;
    case 'merged-ai':    return `    merge: done (AI-resolved)`;
    case 'merge-failed': return `    merge: FAILED — ${event.detail}`;
    default:             return `    merge: ${event.status}`;
  }
}

/**
 * Returns the single-character icon for a story state.
 * Icons: queued=-, building=>, validating=?, pass=+, fail=x
 */
export function storyStateIcon(state: string): string {
  switch (state) {
    case 'queued':     return '-';
    case 'building':   return '>';
    case 'validating': return '?';
    case 'pass':       return '+';
    case 'fail':       return 'x';
    default:           return ' ';
  }
}

/**
 * Formats a single story row for display beneath its parent epic.
 *
 * Format examples:
 *   - queued:     "  - US-001  My Story Title"
 *   - building:   "  > US-002  My Story Title"
 *   - pass:       "  + US-001  My Story Title  PASS  2m 12s"
 *   - fail:       "  x US-003  My Story Title  FAIL: typecheck passes not met  3m 10s"
 *
 * @param story - Full StoryDisplayData including state, failureReason, duration
 */
export function renderStoryRow(story: StoryDisplayData): string {
  const icon = storyStateIcon(story.state);
  const titlePart = story.title.substring(0, 40).padEnd(40);

  let suffix = '';
  if (story.state === 'pass') {
    const dur = story.duration ? `  ${story.duration}` : '';
    suffix = `  PASS${dur}`;
  } else if (story.state === 'fail') {
    const reason = story.failureReason ? `: ${story.failureReason}` : '';
    const dur = story.duration ? `  ${story.duration}` : '';
    suffix = `  FAIL${reason}${dur}`;
  } else if (story.state === 'building') {
    suffix = '  building...';
  } else if (story.state === 'validating') {
    suffix = '  validating...';
  }

  return `  ${icon} ${story.id}  ${titlePart}${suffix}`;
}

/**
 * Renders the footer key bindings line.
 */
export function renderFooter(): string {
  return 'q:quit  r:refresh  d:dashboard  l:logs  arrows:scroll';
}

/**
 * Formats the current-activity sub-line for an active epic.
 * Only shown for epics that are not yet in a terminal state (completed/failed/merge-failed).
 *
 * Format: `    > editing src/api.ts`
 */
export function renderActivityLine(epic: EpicDisplayData): string | null {
  const terminal = ['completed', 'failed', 'merge-failed'];
  if (terminal.includes(epic.status)) return null;
  if (!epic.currentActivity || epic.currentActivity === 'pending') return null;
  return `    > ${epic.currentActivity}`;
}

/**
 * Builds the full epic list content string for the blessed box.
 * Renders each epic row, then an optional merge status line, then an optional
 * activity line, then story rows.
 */
export function renderEpicList(state: DashboardState): string {
  if (state.epics.length === 0) {
    return '  (no epics found — waiting for prd.json)';
  }

  return state.epics.map(epic => {
    const parts: string[] = [renderEpicRow(epic)];

    // Merge status line for epics that have a merge event
    const mergeLine = renderMergeStatusLine(epic, state.mergeEvents ?? []);
    if (mergeLine) parts.push(mergeLine);

    // Activity line for active epics
    const activityLine = renderActivityLine(epic);
    if (activityLine) parts.push(activityLine);

    // Story rows
    if (epic.stories.length > 0) {
      const storyRows = epic.stories.map(story => renderStoryRow(story)).join('\n');
      parts.push(storyRows);
    }

    return parts.join('\n');
  }).join('\n');
}
