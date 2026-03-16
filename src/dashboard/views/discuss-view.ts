/**
 * dashboard/views/discuss-view.ts — Discuss view for failed stories.
 *
 * Provides a read-only context panel followed by a conversation thread
 * letting the user review failure details and type guidance for the next
 * build attempt.
 *
 * Pure rendering module — no blessed dependencies, no I/O.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Context loaded for a single failed story before entering discuss mode.
 * All fields are loaded from filesystem (plan files, progress.txt, prd.json).
 */
export interface DiscussContext {
  storyId: string;
  storyTitle: string;
  epicId: string;
  epicTitle: string;
  /** Short failure reason extracted from prd/stats/progress data, or null. */
  failureReason: string | null;
  /**
   * Lines from progress.txt that describe the validator's verdict for this story.
   * May be empty when progress.txt has no structured report.
   */
  validatorReport: string[];
  /**
   * Git diff (--stat) of commits relevant to this story from the epic's worktree.
   * Empty string when the worktree is missing or git commands fail.
   */
  codeDiff: string;
  /**
   * The plan section describing this story's implementation requirements.
   * Empty string when the plan file is missing or the story section is not found.
   */
  planSection: string;
}

/**
 * A single message in the discuss conversation thread.
 *   - 'context': auto-generated system message shown at the top (failure summary)
 *   - 'user': guidance typed by the user
 */
export interface DiscussMessage {
  role: 'context' | 'user';
  text: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the plan section for a specific story ID from a plan markdown file.
 *
 * Looks for a heading that contains the storyId (e.g. "## US-003") and
 * captures everything up to the next same-level or higher heading (or EOF).
 *
 * Returns an empty string when:
 *   - planContent is empty / whitespace
 *   - No heading mentioning storyId is found
 *
 * @param planContent - Full markdown content of the plan file
 * @param storyId - Story ID to search for, e.g. "US-003"
 */
export function extractPlanSection(planContent: string, storyId: string): string {
  if (!planContent || !planContent.trim()) return '';

  const lines = planContent.split('\n');
  let capturing = false;
  let captureHeadingLevel = 0;
  const capturedLines: string[] = [];

  // Regex: matches a markdown heading that contains the storyId
  const storyIdEscaped = storyId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingWithStoryRe = new RegExp(`^(#{1,6})\\s+.*${storyIdEscaped}`, 'i');
  // Regex: matches any markdown heading
  const anyHeadingRe = /^(#{1,6})\s+/;

  for (const line of lines) {
    if (!capturing) {
      const match = headingWithStoryRe.exec(line);
      if (match) {
        captureHeadingLevel = match[1].length;
        capturing = true;
        capturedLines.push(line);
      }
    } else {
      // Stop at a heading of the same or higher level (lower or equal #-count)
      const headingMatch = anyHeadingRe.exec(line);
      if (headingMatch && headingMatch[1].length <= captureHeadingLevel) {
        break;
      }
      capturedLines.push(line);
    }
  }

  return capturedLines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Separator line used throughout the discuss view. */
const SEP = '─'.repeat(72);

/**
 * Renders the full discuss view as a multi-line string for the blessed content box.
 *
 * Layout:
 *   [Discuss: US-003 — My Story Title]
 *   ────────────────────────────────────────────────────────────────────────
 *   Epic: EPIC-001 — Foundation Epic
 *   Failure: <reason or "(unknown)">
 *   ────────────────────────────────────────────────────────────────────────
 *   Validator report:
 *     <validator lines or "(no report available)">
 *   ────────────────────────────────────────────────────────────────────────
 *   Builder's code diff (--stat):
 *     <diff lines or "(no diff available)">
 *   ────────────────────────────────────────────────────────────────────────
 *   Plan section:
 *     <plan text or "(no plan section found)">
 *   ────────────────────────────────────────────────────────────────────────
 *   Conversation:
 *     <messages…>
 *
 * @param context - Loaded context for the failed story
 * @param messages - Current conversation thread (context + user messages)
 */
export function renderDiscussView(
  context: DiscussContext,
  messages: DiscussMessage[],
): string {
  const lines: string[] = [
    `[Discuss: ${context.storyId} — ${context.storyTitle}]`,
    `[Type guidance below. Press Enter to send. Type "done" or press Esc to finish.]`,
    '',
    SEP,
    `  Epic:    ${context.epicId} — ${context.epicTitle}`,
    `  Failure: ${context.failureReason ?? '(unknown)'}`,
    SEP,
    '  Validator report:',
  ];

  if (context.validatorReport.length === 0) {
    lines.push('    (no report available)');
  } else {
    for (const line of context.validatorReport) {
      lines.push(`    ${line}`);
    }
  }

  lines.push(SEP, "  Builder's code diff (--stat):");
  if (!context.codeDiff) {
    lines.push('    (no diff available)');
  } else {
    const diffLines = context.codeDiff.split('\n');
    for (const line of diffLines) {
      lines.push(`    ${line}`);
    }
  }

  lines.push(SEP, '  Plan section:');
  if (!context.planSection) {
    lines.push('    (no plan section found)');
  } else {
    const planLines = context.planSection.split('\n');
    for (const line of planLines) {
      lines.push(`    ${line}`);
    }
  }

  lines.push(SEP, '  Conversation:');

  if (messages.length === 0) {
    lines.push('    (no messages yet — type below and press Enter)');
  } else {
    for (const msg of messages) {
      if (msg.role === 'context') {
        lines.push(`  [context] ${msg.text}`);
      } else {
        lines.push(`  > ${msg.text}`);
      }
    }
  }

  return lines.join('\n');
}
