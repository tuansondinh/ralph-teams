/**
 * dashboard/guidance-writer.ts — Persists discuss-session guidance to disk.
 *
 * When a user types guidance for a failed story in the discuss view,
 * the messages are serialised and written to a guidance file so that
 * the Builder agent can read them on the next run.
 *
 * Guidance files are written to:
 *   <guidanceDir>/guidance-<storyId>.md
 * e.g.
 *   guidance/guidance-US-003.md
 *
 * Pure I/O module — no blessed dependencies, no TUI state.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DiscussContext, DiscussMessage } from './views/discuss-view';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the canonical file path for a story's guidance file.
 *
 * @param guidanceDir - Directory in which guidance files are stored
 * @param storyId - Story ID, e.g. 'US-003'
 * @returns Absolute or relative path: `<guidanceDir>/guidance-<storyId>.md`
 */
export function guidancePath(guidanceDir: string, storyId: string): string {
  return path.join(guidanceDir, `guidance-${storyId}.md`);
}

/**
 * Returns true when a guidance file already exists for the given story.
 *
 * @param guidanceDir - Directory in which guidance files are stored
 * @param storyId - Story ID, e.g. 'US-003'
 */
export function guidanceExists(guidanceDir: string, storyId: string): boolean {
  try {
    return fs.existsSync(guidancePath(guidanceDir, storyId));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Serialises a discuss session and writes it to disk as a guidance file.
 *
 * The file format is human-readable Markdown so the Builder agent can read it
 * directly without any special parsing:
 *
 * ```markdown
 * # Guidance for <storyId>: <storyTitle>
 *
 * Epic: <epicId> — <epicTitle>
 * Failure reason: <failureReason>
 *
 * ## User Guidance
 *
 * <message 1>
 *
 * <message 2>
 * ```
 *
 * Only 'user' role messages are included — 'context' messages are auto-generated
 * and do not contain user guidance.
 *
 * If there are no user messages the file is still written, containing only
 * the header and failure context (this lets the Builder know a review occurred).
 *
 * The guidance directory is created automatically if it does not exist.
 *
 * @param guidanceDir - Directory in which to write guidance files
 * @param storyId - Story ID, e.g. 'US-003'
 * @param context - Discuss context loaded for the story
 * @param messages - Full message list from the discuss session
 */
export function saveGuidance(
  guidanceDir: string,
  storyId: string,
  context: DiscussContext,
  messages: DiscussMessage[],
): void {
  // Ensure the guidance directory exists
  fs.mkdirSync(guidanceDir, { recursive: true });

  const userMessages = messages.filter(m => m.role === 'user');

  const lines: string[] = [
    `# Guidance for ${context.storyId}: ${context.storyTitle}`,
    '',
    `Epic: ${context.epicId} — ${context.epicTitle}`,
    `Failure reason: ${context.failureReason ?? '(not recorded)'}`,
    '',
    '## User Guidance',
    '',
  ];

  if (userMessages.length === 0) {
    lines.push('(no explicit guidance provided — see failure context above)');
  } else {
    for (const msg of userMessages) {
      lines.push(msg.text);
      lines.push('');
    }
  }

  const content = lines.join('\n');
  fs.writeFileSync(guidancePath(guidanceDir, storyId), content, 'utf-8');
}
