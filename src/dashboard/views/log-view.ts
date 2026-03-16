/**
 * dashboard/views/log-view.ts — Raw log output view.
 *
 * Renders the last N lines of captured raw log output.
 * This is a pure rendering module — no blessed dependencies.
 */

/** Header shown at the top of the raw log view. */
export const LOG_VIEW_HEADER = `[Raw Log Output — press 'd' to return to dashboard]`;

/**
 * Renders the log view content from captured raw log lines.
 *
 * Trims to the last `maxLines` entries so the view fits the terminal.
 * Always ends with the header as a separator prompt.
 *
 * @param rawLines - Bounded buffer of raw log lines (last 10,000 kept by caller)
 * @param maxLines - How many lines to display (default: 200)
 * @returns Multi-line string ready for a blessed box setContent()
 */
export function renderLogView(rawLines: string[], maxLines: number = 200): string {
  const tail = rawLines.length > maxLines
    ? rawLines.slice(rawLines.length - maxLines)
    : rawLines;

  if (tail.length === 0) {
    return `${LOG_VIEW_HEADER}\n\n  (no log output yet — waiting for ralph to produce output)`;
  }

  return `${LOG_VIEW_HEADER}\n${tail.join('\n')}`;
}

/**
 * Appends new lines to a bounded raw log buffer.
 * Keeps at most `maxLines` entries (drops oldest first).
 *
 * @param buffer - Current buffer (mutated in place for efficiency)
 * @param newLines - Lines to append
 * @param maxLines - Maximum lines to retain (default: 10000)
 */
export function appendLogLines(
  buffer: string[],
  newLines: string[],
  maxLines: number = 10000,
): void {
  buffer.push(...newLines);
  if (buffer.length > maxLines) {
    buffer.splice(0, buffer.length - maxLines);
  }
}
