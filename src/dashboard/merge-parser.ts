/**
 * dashboard/merge-parser.ts — Parses merge events from progress.txt content.
 *
 * Matches the four merge outcome patterns written by ralph.sh:
 *   [EPIC-XXX] MERGED (clean) — <date>
 *   [EPIC-XXX] merge conflicts — attempting AI resolution — <date>
 *   [EPIC-XXX] MERGED (AI-resolved) — <date>
 *   [EPIC-XXX] MERGE FAILED (AI resolution failed, files: ...) — <date>
 */

export type MergeStatus = 'merging' | 'merged-clean' | 'merged-ai' | 'merge-failed';

export interface MergeEvent {
  epicId: string;
  status: MergeStatus;
  /** Human-readable detail, e.g. 'clean', 'AI-resolved', 'src/api.ts src/utils.ts' */
  detail: string;
}

/**
 * Parses all merge events from progress.txt content.
 *
 * For epics that appear multiple times (e.g. conflict attempt followed by
 * a final outcome), only the **last** event per epic is kept — this gives
 * the most up-to-date status.
 *
 * @param progressContent - Full text of progress.txt
 * @returns Array of MergeEvent objects (one per epic, latest state)
 */
export function parseMergeEvents(progressContent: string): MergeEvent[] {
  if (!progressContent || progressContent.trim() === '') return [];

  // Map from epicId -> latest MergeEvent to deduplicate
  const byEpic = new Map<string, MergeEvent>();

  for (const line of progressContent.split('\n')) {
    const event = parseMergeLine(line);
    if (event) {
      byEpic.set(event.epicId, event);
    }
  }

  return Array.from(byEpic.values());
}

/**
 * Attempts to parse a single progress.txt line as a merge event.
 * Returns null for lines that don't match any merge pattern.
 */
export function parseMergeLine(line: string): MergeEvent | null {
  if (!line.trim()) return null;

  // Pattern 1: [EPIC-XXX] MERGED (clean)
  //   e.g. "[EPIC-001] MERGED (clean) — Mon Jan  1 00:00:00 UTC 2024"
  const cleanMatch = /^\[([^\]]+)\]\s+MERGED\s+\(clean\)/i.exec(line);
  if (cleanMatch) {
    return { epicId: cleanMatch[1], status: 'merged-clean', detail: 'clean' };
  }

  // Pattern 2: [EPIC-XXX] MERGED (AI-resolved)
  //   e.g. "[EPIC-001] MERGED (AI-resolved) — ..."
  const aiResolvedMatch = /^\[([^\]]+)\]\s+MERGED\s+\(AI-resolved\)/i.exec(line);
  if (aiResolvedMatch) {
    return { epicId: aiResolvedMatch[1], status: 'merged-ai', detail: 'AI-resolved' };
  }

  // Pattern 3: [EPIC-XXX] merge conflicts — attempting AI resolution
  //   e.g. "[EPIC-001] merge conflicts — attempting AI resolution — ..."
  const conflictMatch = /^\[([^\]]+)\]\s+merge\s+conflicts\s+—\s+attempting\s+AI\s+resolution/i.exec(line);
  if (conflictMatch) {
    return { epicId: conflictMatch[1], status: 'merging', detail: 'resolving conflicts' };
  }

  // Pattern 4: [EPIC-XXX] MERGE FAILED (AI resolution failed, files: ...)
  //   e.g. "[EPIC-001] MERGE FAILED (AI resolution failed, files: src/api.ts) — ..."
  const failedMatch = /^\[([^\]]+)\]\s+MERGE\s+FAILED\s+\(([^)]*)\)/i.exec(line);
  if (failedMatch) {
    const rawDetail = failedMatch[2].trim();
    // Extract filenames from "AI resolution failed, files: src/api.ts src/utils.ts"
    const filesMatch = /files:\s*(.+)$/i.exec(rawDetail);
    const detail = filesMatch ? filesMatch[1].trim() : rawDetail;
    return { epicId: failedMatch[1], status: 'merge-failed', detail };
  }

  return null;
}

/**
 * Returns a human-readable label for a merge status.
 */
export function mergeStatusLabel(status: MergeStatus): string {
  switch (status) {
    case 'merging':      return 'resolving conflicts';
    case 'merged-clean': return 'done (clean)';
    case 'merged-ai':    return 'done (AI-resolved)';
    case 'merge-failed': return 'FAILED';
  }
}
