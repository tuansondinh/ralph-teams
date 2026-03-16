/**
 * dashboard/views/epic-detail-view.ts — Epic detail view rendering.
 *
 * Shows full story status, cycle details, and recent log tail for a single epic.
 * Pure rendering module — no blessed dependencies.
 */

import { DashboardState, EpicDisplayData, StoryDisplayData } from '../types';
import { formatCost, storyStateIcon } from '../renderer';
import { readLogTail, findLatestEpicLog } from '../activity-parser';

/** Header shown at the top of the epic detail view. */
export const EPIC_DETAIL_HEADER = `[Epic Detail — press 'q' or Esc to return to dashboard]`;

/** Number of log tail lines shown in the bottom section. */
const LOG_TAIL_LINE_COUNT = 15;

/**
 * Renders a detailed story row for the epic detail view.
 * Includes story ID, title, state icon, duration, failure reason, and cycle details.
 *
 * Format:
 *   " 1. + US-001  Title...                              PASS  [2m 0s]"
 *   "      Attempt 1: Builder→Validator PASS"
 *
 *   " 2. x US-002  Title...                              FAIL: reason  [3m]"
 *   "      Attempt 1: Builder→Validator FAIL — typecheck error"
 *   "      Attempt 2: Builder→Validator FAIL — still failing"
 *
 * @param story - Full StoryDisplayData including cycles
 * @param index - 0-based position (used for visual numbering)
 */
export function renderDetailStoryRow(story: StoryDisplayData, index: number): string {
  const icon = storyStateIcon(story.state);
  const num = String(index + 1).padStart(2);
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

  const lines: string[] = [`  ${num}. ${icon} ${story.id}  ${titlePart}${detail}`];

  // Append per-cycle detail lines when available
  if (story.cycles && story.cycles.length > 0) {
    for (const cycle of story.cycles) {
      const cycleResult = cycle.result === 'pass' ? 'PASS' : 'FAIL';
      const failStr = cycle.failureDetail ? ` — ${cycle.failureDetail}` : '';
      lines.push(`       Attempt ${cycle.attempt}: Builder→Validator ${cycleResult}${failStr}`);
    }
  }

  return lines.join('\n');
}

/**
 * Renders the full epic detail view content string.
 *
 * Layout:
 *   [header]
 *   EPIC-XXX: Title  status  cost  time
 *   ────────────────────────────────────
 *   Stories:
 *     1. + US-001  Title                                      PASS  2m 12s
 *     2. x US-002  Title                                      FAIL: reason  3m
 *     ...
 *   ────────────────────────────────────
 *   Recent log (last 15 lines):
 *     <log content>
 *
 * @param epic - The epic to render
 * @param logTail - Pre-fetched log tail string (empty string if unavailable)
 */
export function renderEpicDetail(epic: EpicDisplayData, logTail: string): string {
  const sep = '─'.repeat(72);

  // Top section: epic summary
  const costStr = epic.costActual !== null ? formatCost(epic.costActual) : (epic.costEstimate ?? '--');
  const timeStr = epic.timeActual ?? (epic.timeEstimate ?? '--');
  const topSection = [
    EPIC_DETAIL_HEADER,
    '',
    `  ${epic.id}: ${epic.title}`,
    `  Status: ${epic.status}  |  Cost: ${costStr}  |  Time: ${timeStr}`,
    `  Progress: ${epic.storiesPassed}/${epic.storiesTotal} stories passed`,
    sep,
  ];

  // Middle section: story rows
  const storySection: string[] = ['  Stories:'];
  if (epic.stories.length === 0) {
    storySection.push('    (no stories)');
  } else {
    epic.stories.forEach((story, i) => {
      storySection.push(renderDetailStoryRow(story, i));
    });
  }

  storySection.push(sep);

  // Bottom section: log tail
  const logSection: string[] = [`  Recent log (last ${LOG_TAIL_LINE_COUNT} lines):`];
  if (!logTail || logTail.trim() === '') {
    logSection.push('    (no log output available)');
  } else {
    const logLines = logTail.split('\n');
    const tail = logLines.length > LOG_TAIL_LINE_COUNT
      ? logLines.slice(logLines.length - LOG_TAIL_LINE_COUNT)
      : logLines;
    tail.forEach(line => logSection.push(`  ${line}`));
  }

  return [...topSection, ...storySection, ...logSection].join('\n');
}

/**
 * Finds the epic with the given ID in state and renders its detail view.
 * Also reads the epic's log tail from the logs directory.
 *
 * Returns null if the epic is not found in state.
 *
 * @param state - Current DashboardState
 * @param epicId - Epic ID to show detail for
 * @param logsDir - Directory containing epic log files
 * @param backend - Backend type ('claude' or 'copilot') for log parsing
 */
export function renderEpicDetailFromState(
  state: DashboardState,
  epicId: string,
  logsDir: string,
  backend: string = 'claude',
): string | null {
  const epic = state.epics.find(e => e.id === epicId);
  if (!epic) return null;

  // Read log tail from the epic's log file
  let logTail = '';
  try {
    const logFile = findLatestEpicLog(logsDir, epicId);
    if (logFile) {
      logTail = readLogTail(logFile, LOG_TAIL_LINE_COUNT);
    }
  } catch {
    // silently ignore log read errors
  }

  return renderEpicDetail(epic, logTail);
}
