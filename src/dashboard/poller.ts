/**
 * dashboard/poller.ts — File polling engine for the TUI dashboard.
 *
 * Uses setInterval to periodically read prd.json, progress.txt, and
 * ralph-run-stats.json, then calls onUpdate with updated state.
 * mtime caching avoids re-parsing unchanged files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DashboardOptions, DashboardState, EpicDisplayData, StoryDisplayData } from './types';
import { Prd, Epic } from '../prd-utils';
import { RunStats } from '../run-stats';
import { formatDuration } from '../time-utils';

/** mtime cache to avoid re-parsing unchanged files */
interface MtimeCache {
  prd: number;
  progress: number;
  stats: number;
}

/** Poller handle returned by createPoller */
export interface Poller {
  start(): void;
  stop(): void;
}

/**
 * Dependencies for the poller (injectable for testing).
 */
export interface PollerDeps {
  existsSync: typeof fs.existsSync;
  readFileSync: typeof fs.readFileSync;
  statSync: typeof fs.statSync;
}

const defaultPollerDeps: PollerDeps = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  statSync: fs.statSync,
};

/**
 * Parses prd.json and returns epic display data.
 * Returns an empty array if file is missing or invalid.
 */
export function parseEpicsFromPrd(content: string, statsEpics: RunStats['epics']): EpicDisplayData[] {
  let prd: Prd;
  try {
    prd = JSON.parse(content) as Prd;
  } catch {
    return [];
  }

  return (prd.epics ?? []).map(epic => {
    const statsEpic = statsEpics.find(e => e.epicId === epic.id);
    const stories = buildStoryDisplayData(epic);

    return {
      id: epic.id,
      title: epic.title,
      status: epic.status,
      storiesPassed: epic.userStories.filter(s => s.passes).length,
      storiesTotal: epic.userStories.length,
      stories,
      currentActivity: inferCurrentActivity(epic),
      costActual: statsEpic?.totalCostUsd ?? null,
      costEstimate: null,
      timeActual: statsEpic?.durationFormatted ?? null,
      timeEstimate: null,
      mergeStatus: epic.status === 'merge-failed' ? 'failed' : null,
    };
  });
}

/**
 * Infers a human-readable current activity label for an epic.
 */
function inferCurrentActivity(epic: Epic): string {
  switch (epic.status) {
    case 'completed': return 'done';
    case 'failed': return 'failed';
    case 'merge-failed': return 'merge failed';
    case 'partial': return 'partial';
    default: return 'pending';
  }
}

/**
 * Builds StoryDisplayData from an epic's user stories.
 */
function buildStoryDisplayData(epic: Epic): StoryDisplayData[] {
  return epic.userStories.map(story => ({
    id: story.id,
    title: story.title,
    state: story.passes ? 'pass' : (epic.status === 'pending' ? 'queued' : 'fail'),
    failureReason: null,
    duration: null,
  }));
}

/**
 * Parses the current wave number from progress.txt.
 * Looks for the last line matching `=== Wave N`.
 * Returns 0 if not found.
 */
export function parseWaveFromProgress(content: string): number {
  const lines = content.split('\n');
  let wave = 0;
  for (const line of lines) {
    const match = /=== Wave (\d+)/i.exec(line);
    if (match) {
      wave = parseInt(match[1], 10);
    }
  }
  return wave;
}

/**
 * Computes a total elapsed time string from a run stats startedAt value.
 * Returns '--' if no start time is available.
 */
export function computeElapsed(startedAt: string | null): string {
  if (!startedAt) return '--';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '--';
  return formatDuration(ms);
}

/**
 * Builds DashboardState from raw file contents.
 * Any file can be null (missing/unreadable), in which case defaults are used.
 */
export function buildStateFromFiles(
  prdContent: string | null,
  progressContent: string | null,
  statsContent: string | null,
  projectName: string,
): DashboardState {
  let statsData: RunStats | null = null;
  if (statsContent) {
    try {
      statsData = JSON.parse(statsContent) as RunStats;
    } catch {
      // ignore
    }
  }

  const statsEpics = statsData?.epics ?? [];
  const epics = prdContent ? parseEpicsFromPrd(prdContent, statsEpics) : [];

  // Extract project name from prd if available
  let resolvedProjectName = projectName;
  if (prdContent) {
    try {
      const prd = JSON.parse(prdContent) as Prd;
      if (prd.project) resolvedProjectName = prd.project;
    } catch {
      // ignore
    }
  }

  const currentWave = progressContent ? parseWaveFromProgress(progressContent) : 0;
  const startedAt = statsData?.totals?.startedAt ? new Date(statsData.totals.startedAt) : null;
  const totalCostUsd = statsData?.totals?.costUsd ?? null;
  const totalElapsed = computeElapsed(statsData?.totals?.startedAt ?? null);

  return {
    projectName: resolvedProjectName,
    currentWave,
    startedAt,
    epics,
    totalCostUsd,
    totalElapsed,
    viewMode: 'dashboard',
    selectedEpicId: null,
    rawLogLines: [],
  };
}

/**
 * Creates a polling engine that reads data files and calls onUpdate.
 * Uses mtime caching to avoid re-parsing unchanged files.
 *
 * @param options - Dashboard configuration (paths, interval)
 * @param onUpdate - Called with full new state on each poll tick
 * @param deps - Injectable filesystem deps (for testing)
 */
export function createPoller(
  options: DashboardOptions,
  onUpdate: (state: DashboardState) => void,
  deps: PollerDeps = defaultPollerDeps,
): Poller {
  let handle: ReturnType<typeof setInterval> | null = null;
  const mtimes: MtimeCache = { prd: 0, progress: 0, stats: 0 };

  // Cached content strings to avoid re-parsing
  let cachedPrd: string | null = null;
  let cachedProgress: string | null = null;
  let cachedStats: string | null = null;

  function getMtime(filePath: string): number {
    try {
      return deps.statSync(filePath).mtimeMs;
    } catch {
      return 0;
    }
  }

  function readIfChanged(
    filePath: string,
    cachedMtime: number,
    cached: string | null,
  ): { content: string | null; mtime: number; changed: boolean } {
    const mtime = getMtime(filePath);
    if (mtime === 0) {
      // File doesn't exist
      return { content: null, mtime: 0, changed: cachedMtime !== 0 };
    }
    if (mtime === cachedMtime && cached !== null) {
      // File unchanged
      return { content: cached, mtime, changed: false };
    }
    try {
      const content = deps.readFileSync(filePath, 'utf-8') as string;
      return { content, mtime, changed: true };
    } catch {
      return { content: null, mtime: 0, changed: true };
    }
  }

  function poll(): void {
    const prdResult = readIfChanged(options.prdPath, mtimes.prd, cachedPrd);
    const progressResult = readIfChanged(options.progressPath, mtimes.progress, cachedProgress);
    const statsResult = readIfChanged(options.statsPath, mtimes.stats, cachedStats);

    const anyChanged = prdResult.changed || progressResult.changed || statsResult.changed;

    // Update caches
    if (prdResult.changed) {
      mtimes.prd = prdResult.mtime;
      cachedPrd = prdResult.content;
    }
    if (progressResult.changed) {
      mtimes.progress = progressResult.mtime;
      cachedProgress = progressResult.content;
    }
    if (statsResult.changed) {
      mtimes.stats = statsResult.mtime;
      cachedStats = statsResult.content;
    }

    if (anyChanged) {
      const state = buildStateFromFiles(
        cachedPrd,
        cachedProgress,
        cachedStats,
        '(loading...)',
      );
      onUpdate(state);
    }
  }

  return {
    start() {
      // Run immediately, then on interval
      poll();
      handle = setInterval(poll, options.pollIntervalMs);
    },
    stop() {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    },
  };
}
