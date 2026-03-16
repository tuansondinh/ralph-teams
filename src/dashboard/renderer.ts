/**
 * dashboard/renderer.ts — Pure rendering functions for the TUI dashboard.
 *
 * All functions here are pure (no blessed dependencies) so they can be
 * unit-tested without a terminal.
 */

import { DashboardState, EpicDisplayData } from './types';

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
 */
export function renderHeader(state: DashboardState): string[] {
  const project = state.projectName || '(no project)';
  const wave = state.currentWave > 0 ? `Wave ${state.currentWave}` : 'Wave --';
  const elapsed = state.totalElapsed || '--';

  const costStr = state.totalCostUsd !== null
    ? `$${state.totalCostUsd.toFixed(2)}`
    : '--';

  return [
    `Ralph Teams — ${project}`,
    `${wave}  |  Elapsed: ${elapsed}  |  Cost: ${costStr}`,
  ];
}

/**
 * Formats a single epic row for the epic list box.
 * Returns the formatted string representation.
 */
export function renderEpicRow(epic: EpicDisplayData): string {
  const bar = formatProgressBar(epic.storiesPassed, epic.storiesTotal);
  const status = epicStatusSymbol(epic.status);
  const cost = epic.costActual !== null ? formatCost(epic.costActual) : (epic.costEstimate ?? '--');
  const time = epic.timeActual ?? (epic.timeEstimate ?? '--');
  return `${status} ${epic.id}: ${epic.title.substring(0, 28).padEnd(28)} ${bar}  cost:${cost}  time:${time}`;
}

/**
 * Formats story rows for epic detail view.
 */
export function renderStoryRow(story: { id: string; title: string; state: string; duration: string | null }): string {
  const stateMap: Record<string, string> = {
    queued:     '[ wait ]',
    building:   '[ build]',
    validating: '[ valid]',
    pass:       '[ PASS ]',
    fail:       '[ FAIL ]',
  };
  const stateStr = stateMap[story.state] ?? '[     ]';
  const dur = story.duration ? `  ${story.duration}` : '';
  return `  ${stateStr} ${story.id}: ${story.title.substring(0, 40)}${dur}`;
}

/**
 * Renders the footer key bindings line.
 */
export function renderFooter(): string {
  return 'q:quit  r:refresh  d:dashboard  l:logs  arrows:scroll';
}

/**
 * Builds the full epic list content string for the blessed box.
 */
export function renderEpicList(state: DashboardState): string {
  if (state.epics.length === 0) {
    return '  (no epics found — waiting for prd.json)';
  }

  return state.epics.map(epic => renderEpicRow(epic)).join('\n');
}
