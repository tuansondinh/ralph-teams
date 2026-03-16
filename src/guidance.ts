/**
 * guidance.ts — Standalone module for persisting and loading story guidance.
 *
 * When a user discusses a failed story with the discuss agent, their guidance
 * is saved to a file so the Builder agent can incorporate it on the next run.
 *
 * Guidance files are written to:
 *   <guidanceDir>/<storyId>.md   (default guidanceDir: 'guidance')
 * e.g.
 *   guidance/US-003.md
 *
 * Pure I/O module — no TUI or dashboard dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Default directory for guidance files, relative to project root. */
const DEFAULT_GUIDANCE_DIR = 'guidance';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the canonical file path for a story's guidance file.
 *
 * @param storyId    - Story ID, e.g. 'US-003'
 * @param guidanceDir - Directory in which guidance files are stored (default: 'guidance')
 * @returns Path: `<guidanceDir>/<storyId>.md`
 */
export function getGuidancePath(storyId: string, guidanceDir: string = DEFAULT_GUIDANCE_DIR): string {
  return path.join(guidanceDir, `${storyId}.md`);
}

// ---------------------------------------------------------------------------
// Content formatter
// ---------------------------------------------------------------------------

/**
 * Formats guidance context into a human-readable Markdown string.
 *
 * The Builder agent reads this file directly, so the format is intentionally
 * simple and readable without special parsing.
 *
 * @param context - Guidance context with failure details and user instructions
 * @returns Formatted markdown string
 */
export function formatGuidanceContent(context: {
  failureContext: string;
  userInstructions: string;
  approach: string;
}): string {
  const lines: string[] = [
    '# Story Guidance',
    '',
    '## Failure Context',
    '',
    context.failureContext.trim() || '(no failure context recorded)',
    '',
    '## User Instructions',
    '',
    context.userInstructions.trim() || '(no explicit instructions provided)',
    '',
    '## Agreed Approach',
    '',
    context.approach.trim() || '(no specific approach agreed upon)',
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Persists guidance to disk as a Markdown file.
 *
 * Creates the guidance directory automatically if it does not exist.
 *
 * @param storyId     - Story ID, e.g. 'US-003'
 * @param context     - Guidance context (failure, instructions, approach)
 * @param guidanceDir - Directory in which to write guidance files (default: 'guidance')
 * @returns The file path where the guidance was written
 */
export function saveGuidance(
  storyId: string,
  context: { failureContext: string; userInstructions: string; approach: string },
  guidanceDir: string = DEFAULT_GUIDANCE_DIR,
): string {
  // Ensure the guidance directory exists
  fs.mkdirSync(guidanceDir, { recursive: true });

  const filePath = getGuidancePath(storyId, guidanceDir);
  const content = formatGuidanceContent(context);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Reads the guidance file for a story, or returns null if it does not exist.
 *
 * @param storyId     - Story ID, e.g. 'US-003'
 * @param guidanceDir - Directory in which guidance files are stored (default: 'guidance')
 * @returns The guidance file contents, or null if the file does not exist
 */
export function loadGuidance(storyId: string, guidanceDir: string = DEFAULT_GUIDANCE_DIR): string | null {
  const filePath = getGuidancePath(storyId, guidanceDir);
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
