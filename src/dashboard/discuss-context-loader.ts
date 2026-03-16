/**
 * dashboard/discuss-context-loader.ts — File I/O for loading discuss context.
 *
 * Loads the plan section and validator report for a failed story so the
 * discuss view can display them. All functions gracefully return empty
 * values when files are missing or parsing finds nothing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractPlanSection, DiscussContext } from './views/discuss-view';
import { DashboardState } from './types';

// ---------------------------------------------------------------------------
// Plan loading
// ---------------------------------------------------------------------------

/**
 * Loads and returns the plan section for a specific story from the plan file
 * for its parent epic.
 *
 * Plan files are expected at: `<plansDir>/plan-<epicId>.md`
 * (e.g. `plans/plan-EPIC-001.md`)
 *
 * Returns an empty string when:
 *   - The plan file does not exist
 *   - The file cannot be read
 *   - No section mentioning storyId is found in the file
 *
 * @param plansDir - Directory containing plan markdown files
 * @param epicId - Epic ID, e.g. "EPIC-001"
 * @param storyId - Story ID to find in the plan, e.g. "US-003"
 */
export function loadPlanSectionForStory(
  plansDir: string,
  epicId: string,
  storyId: string,
): string {
  const planFile = path.join(plansDir, `plan-${epicId}.md`);
  let content: string;
  try {
    content = fs.readFileSync(planFile, 'utf-8');
  } catch {
    return '';
  }
  return extractPlanSection(content, storyId);
}

// ---------------------------------------------------------------------------
// Validator report extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the validator-relevant lines for a story from progress.txt content.
 *
 * Looks for the last story block mentioning storyId in progress.txt (the
 * final attempt), then collects lines that describe validator feedback:
 *   - Lines containing "Validator verdict", "Validator feedback", "Result: FAIL"
 *   - Lines prefixed with "- " or "* " within the story block
 *
 * Returns up to 20 lines. Returns an empty array when progressContent is
 * empty or no story block is found.
 *
 * @param progressContent - Full content of progress.txt (or null)
 * @param storyId - Story ID to search for, e.g. "US-003"
 */
export function extractValidatorReport(
  progressContent: string | null,
  storyId: string,
): string[] {
  if (!progressContent || !storyId) return [];

  const storyIdEscaped = storyId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match a "## …<storyId>…" heading line
  const blockHeadingRe = new RegExp(`^##[^\n]*${storyIdEscaped}[^\n]*$`, 'gim');

  // Find all block start positions
  const blockStarts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockHeadingRe.exec(progressContent)) !== null) {
    blockStarts.push(m.index);
  }

  if (blockStarts.length === 0) return [];

  // Use the last block (most recent attempt)
  const blockStart = blockStarts[blockStarts.length - 1];
  // Find the next "## " heading to delimit the block, or use EOF
  const nextHeadingRe = /^##\s+/m;
  const rest = progressContent.slice(blockStart + 1); // +1 to skip current heading
  const nextMatch = nextHeadingRe.exec(rest);
  const blockEnd = nextMatch
    ? blockStart + 1 + nextMatch.index
    : progressContent.length;

  const block = progressContent.slice(blockStart, blockEnd);
  const lines = block.split('\n');

  // Collect relevant lines: validator mentions, result lines, bullet points
  const reportLines: string[] = [];
  for (const line of lines) {
    if (
      /Result:/i.test(line) ||
      /Validator\s*(verdict|feedback)/i.test(line) ||
      /^[-*]\s+/.test(line.trim())
    ) {
      reportLines.push(line.trimEnd());
      if (reportLines.length >= 20) break;
    }
  }

  return reportLines;
}

// ---------------------------------------------------------------------------
// Full context builder
// ---------------------------------------------------------------------------

/**
 * Builds a DiscussContext for a failed story by looking up the story/epic in
 * the current DashboardState and loading file-backed context.
 *
 * @param state - Current DashboardState
 * @param storyId - ID of the story to discuss
 * @param plansDir - Directory containing plan-<epicId>.md files
 * @param progressContent - Raw progress.txt content, or null if unavailable
 */
export function buildDiscussContext(
  state: DashboardState,
  storyId: string,
  plansDir: string,
  progressContent: string | null,
): DiscussContext | null {
  // Find the story in the current state
  for (const epic of state.epics) {
    const story = epic.stories.find(s => s.id === storyId);
    if (story) {
      const planSection = loadPlanSectionForStory(plansDir, epic.id, storyId);
      const validatorReport = extractValidatorReport(progressContent, storyId);

      return {
        storyId: story.id,
        storyTitle: story.title,
        epicId: epic.id,
        epicTitle: epic.title,
        failureReason: story.failureReason,
        validatorReport,
        planSection,
      };
    }
  }
  return null;
}
