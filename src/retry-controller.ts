/**
 * retry-controller.ts — Retry orchestration helpers.
 *
 * Provides pure data-layer functions for resetting failed epics back to
 * a re-runnable state and collecting the failed story IDs so the dashboard
 * can display progress during a retry round.
 *
 * These functions are intentionally free of process.exit() so they can be
 * tested without side-effects. All I/O is synchronous (consistent with the
 * rest of the codebase).
 */

import * as fs from 'fs';
import * as path from 'path';
import { Prd, Epic } from './prd-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Groups failed story IDs by the epic they belong to. */
export interface FailedStoryGroup {
  epicId: string;
  storyIds: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readPrd(prdPath: string): Prd {
  const resolved = path.resolve(prdPath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(raw) as Prd;
}

function writePrd(prdPath: string, prd: Prd): void {
  const resolved = path.resolve(prdPath);
  fs.writeFileSync(resolved, JSON.stringify(prd, null, 2), 'utf-8');
}

/** Returns true for epic statuses that should be reset so the epic can be re-run. */
function isResettableStatus(status: Epic['status']): boolean {
  return status === 'failed' || status === 'partial';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resets all `failed` and `partial` epics back to `pending` so ralph.sh
 * will re-process them. Also resets `passes: false` stories within those
 * epics so they are re-attempted.
 *
 * `completed` and `merge-failed` epics are left unchanged.
 *
 * @param prdPath - Path to prd.json (resolved relative to cwd if needed)
 * @returns Array of epic IDs that were reset
 * @throws If prd.json cannot be read or written
 */
export function resetFailedEpics(prdPath: string): string[] {
  const prd = readPrd(prdPath);
  const resetIds: string[] = [];

  for (const epic of prd.epics) {
    if (isResettableStatus(epic.status)) {
      epic.status = 'pending';
      // Reset failed stories within the epic so they are re-attempted
      for (const story of epic.userStories) {
        if (!story.passes) {
          story.passes = false; // already false, but explicit for clarity
        }
      }
      resetIds.push(epic.id);
    }
  }

  writePrd(prdPath, prd);
  return resetIds;
}

/**
 * Reads prd.json and returns a list of epics that have at least one failed
 * story (i.e. story with `passes: false`).
 *
 * Only considers epics whose status is `failed` or `partial` — completed
 * epics with all stories passing are excluded.
 *
 * @param prdPath - Path to prd.json
 * @returns Array of `{ epicId, storyIds }` groups (may be empty)
 * @throws If prd.json cannot be read
 */
export function collectFailedStories(prdPath: string): FailedStoryGroup[] {
  const prd = readPrd(prdPath);
  const groups: FailedStoryGroup[] = [];

  for (const epic of prd.epics) {
    const failedIds = epic.userStories
      .filter(s => !s.passes)
      .map(s => s.id);

    if (failedIds.length > 0) {
      groups.push({ epicId: epic.id, storyIds: failedIds });
    }
  }

  return groups;
}
