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
 * Renders the footer key bindings line based on the current view mode.
 *
 * @param viewMode - Current view: 'dashboard', 'logs', 'epic-detail', 'summary', or 'discuss'
 * @param awaitingEpicNumber - When true, show the epic-select prompt
 * @param hasFailedStories - When true and in summary mode, show the interactive menu
 */
export function renderFooter(
  viewMode: DashboardState['viewMode'] = 'dashboard',
  awaitingEpicNumber: boolean = false,
  hasFailedStories: boolean = false,
): string {
  if (awaitingEpicNumber) {
    return 'Press epic number (1-9)... [Esc to cancel]';
  }
  switch (viewMode) {
    case 'logs':
      return '[d] dashboard  [q] quit  arrows:scroll';
    case 'epic-detail':
      return '[q/Esc] back to dashboard  arrows:scroll';
    case 'summary':
      return hasFailedStories
        ? '[d] discuss a story  [r] retry all failed  [q] quit'
        : 'All stories passed! [q] quit';
    case 'discuss':
      return '[q/Esc] back to summary';
    default:
      return '[d] logs  [e] epic detail  [q] quit  arrows:scroll';
  }
}

/**
 * Renders the raw log view content.
 * Shows the last `maxLines` lines from the raw log buffer.
 *
 * @param rawLines - Bounded buffer of raw log lines
 * @param maxLines - How many lines to show (default: 200)
 */
export function renderRawLogView(rawLines: string[], maxLines: number = 200): string {
  const tail = rawLines.length > maxLines
    ? rawLines.slice(rawLines.length - maxLines)
    : rawLines;

  const header = `[Raw Log Output — press 'd' to return to dashboard]`;

  if (tail.length === 0) {
    return `${header}\n\n  (no log output yet — waiting for ralph to produce output)`;
  }

  return `${header}\n${tail.join('\n')}`;
}

/**
 * Renders the epic detail view content for a given epic.
 * Returns a placeholder string if epicId is not found in state.
 *
 * @param state - Current DashboardState
 * @param epicId - ID of the epic to show detail for
 * @param logTail - Pre-fetched log tail string (pass empty string if unavailable)
 */
export function renderEpicDetailContent(
  state: DashboardState,
  epicId: string | null,
  logTail: string,
): string {
  if (!epicId) return '  (no epic selected)';

  const epic = state.epics.find(e => e.id === epicId);
  if (!epic) return `  (epic ${epicId} not found)`;

  const sep = '─'.repeat(72);

  // Top section: epic summary
  const costStr = epic.costActual !== null ? formatCost(epic.costActual) : (epic.costEstimate ?? '--');
  const timeStr = epic.timeActual ?? (epic.timeEstimate ?? '--');

  const lines: string[] = [
    `[Epic Detail — press 'q' or Esc to return to dashboard]`,
    '',
    `  ${epic.id}: ${epic.title}`,
    `  Status: ${epic.status}  |  Cost: ${costStr}  |  Time: ${timeStr}`,
    `  Progress: ${epic.storiesPassed}/${epic.storiesTotal} stories passed`,
    sep,
    '  Stories:',
  ];

  if (epic.stories.length === 0) {
    lines.push('    (no stories)');
  } else {
    epic.stories.forEach((story, i) => {
      const icon = storyStateIcon(story.state);
      const num = String(i + 1).padStart(2);
      const titlePart = story.title.substring(0, 45).padEnd(45);
      const dur = story.duration ? `  [${story.duration}]` : '';

      let detail = '';
      if (story.state === 'pass') {
        detail = `  PASS${dur}`;
      } else if (story.state === 'fail') {
        const reason = story.failureReason ? `: ${story.failureReason}` : '';
        detail = `  FAIL${reason}${dur}`;
      } else if (story.state === 'building') {
        detail = '  building...';
      } else if (story.state === 'validating') {
        detail = '  validating...';
      }

      lines.push(`  ${num}. ${icon} ${story.id}  ${titlePart}${detail}`);

      // Render per-cycle Builder→Validator details when available
      if (story.cycles && story.cycles.length > 0) {
        for (const cycle of story.cycles) {
          const cycleResult = cycle.result === 'pass' ? 'PASS' : 'FAIL';
          const failStr = cycle.failureDetail ? ` — ${cycle.failureDetail}` : '';
          lines.push(`       Attempt ${cycle.attempt}: Builder→Validator ${cycleResult}${failStr}`);
        }
      }
    });
  }

  lines.push(sep);
  lines.push('  Recent log (last 15 lines):');

  if (!logTail || logTail.trim() === '') {
    lines.push('    (no log output available)');
  } else {
    const logLines = logTail.split('\n');
    const tail = logLines.length > 15
      ? logLines.slice(logLines.length - 15)
      : logLines;
    tail.forEach(line => lines.push(`  ${line}`));
  }

  return lines.join('\n');
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
