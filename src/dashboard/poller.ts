/**
 * dashboard/poller.ts — File polling engine for the TUI dashboard.
 *
 * Uses setInterval to periodically read prd.json, progress.txt, and
 * ralph-run-stats.json, then calls onUpdate with updated state.
 * mtime caching avoids re-parsing unchanged files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DashboardOptions, DashboardState, EpicDisplayData, StoryDisplayData, MergeEvent } from './types';
import { Prd, Epic } from '../prd-utils';
import { RunStats, StoryStats } from '../run-stats';
import { formatDuration } from '../time-utils';
import {
  determineStoryState,
  filterProgressLinesForStory,
  StoryStateInput,
} from './story-state-parser';
import {
  findLatestEpicLog,
  readLogTail,
  parseLatestActivity,
} from './activity-parser';
import { parseMergeEvents } from './merge-parser';

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
  /** Reads the tail of a log file. Defaults to readLogTail. */
  readLogTail?: typeof readLogTail;
  /** Finds the latest log file for an epic. Defaults to findLatestEpicLog. */
  findLatestEpicLog?: typeof findLatestEpicLog;
  /** Backend name for activity parsing ('claude' | 'copilot'). Defaults to 'claude'. */
  backend?: string;
}

const defaultPollerDeps: PollerDeps = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  statSync: fs.statSync,
  readLogTail,
  findLatestEpicLog,
  backend: 'claude',
};

/**
 * Parses prd.json and returns epic display data.
 * Returns an empty array if file is missing or invalid.
 *
 * @param content - Raw prd.json file content
 * @param statsEpics - Parsed epic stats from ralph-run-stats.json
 * @param progressContent - Raw progress.txt content (or null if unavailable)
 * @param activityMap - Map from epicId to current activity string (from log polling)
 * @param avgCostPerStory - Average cost per story from run estimates (for per-epic estimates)
 * @param avgTimePerStoryMs - Average time per story in ms from run estimates
 */
export function parseEpicsFromPrd(
  content: string,
  statsEpics: RunStats['epics'],
  progressContent: string | null = null,
  activityMap: Map<string, string> = new Map(),
  avgCostPerStory: number | null = null,
  avgTimePerStoryMs: number | null = null,
): EpicDisplayData[] {
  let prd: Prd;
  try {
    prd = JSON.parse(content) as Prd;
  } catch {
    return [];
  }

  return (prd.epics ?? []).map(epic => {
    const statsEpic = statsEpics.find(e => e.epicId === epic.id);
    const storyStatsMap = buildStoryStatsMap(statsEpic?.stories ?? []);
    const stories = buildStoryDisplayData(epic, storyStatsMap, progressContent);

    // Use log-derived activity if available, otherwise infer from epic status
    const currentActivity = activityMap.get(epic.id) ?? inferCurrentActivity(epic);

    // Per-epic cost estimate: actual so far + avg * remaining stories
    const storiesPassed = epic.userStories.filter(s => s.passes).length;
    const storiesTotal = epic.userStories.length;
    const storiesRemaining = storiesTotal - storiesPassed;
    const actualCost = statsEpic?.totalCostUsd ?? null;
    const actualTime = statsEpic?.durationFormatted ?? null;

    const costEstimate = computeEpicCostEstimate(actualCost, storiesRemaining, avgCostPerStory);
    const timeEstimate = computeEpicTimeEstimate(actualTime, storiesRemaining, avgTimePerStoryMs);

    return {
      id: epic.id,
      title: epic.title,
      status: epic.status,
      storiesPassed,
      storiesTotal,
      stories,
      currentActivity,
      costActual: actualCost,
      costEstimate,
      timeActual: actualTime,
      timeEstimate,
      mergeStatus: epic.status === 'merge-failed' ? 'failed' : null,
    };
  });
}

/**
 * Computes a per-epic estimated total cost string.
 * Returns null when no avg is available or the epic is already complete.
 */
export function computeEpicCostEstimate(
  actualCost: number | null,
  storiesRemaining: number,
  avgCostPerStory: number | null,
): string | null {
  if (avgCostPerStory === null) return null;
  if (storiesRemaining <= 0) return null; // done, no estimate needed
  const estimated = (actualCost ?? 0) + avgCostPerStory * storiesRemaining;
  return `~$${estimated.toFixed(2)}`;
}

/**
 * Computes a per-epic estimated total time string.
 * Returns null when no avg is available or the epic is already complete.
 */
export function computeEpicTimeEstimate(
  actualTime: string | null,
  storiesRemaining: number,
  avgTimePerStoryMs: number | null,
): string | null {
  if (avgTimePerStoryMs === null) return null;
  if (storiesRemaining <= 0) return null;
  // We don't have actual time in ms per epic here, so just show remaining estimate
  const remainingMs = avgTimePerStoryMs * storiesRemaining;
  return `~${formatDuration(remainingMs)} remaining`;
}

/**
 * Builds a map from storyId → StoryStats for quick lookup.
 */
function buildStoryStatsMap(stories: StoryStats[]): Map<string, StoryStats> {
  const map = new Map<string, StoryStats>();
  for (const s of stories) {
    map.set(s.storyId, s);
  }
  return map;
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
 * Builds StoryDisplayData from an epic's user stories, incorporating stats and progress data.
 *
 * @param epic - Parsed epic from prd.json
 * @param storyStatsMap - Map from storyId to StoryStats
 * @param progressContent - Raw progress.txt content (or null)
 */
function buildStoryDisplayData(
  epic: Epic,
  storyStatsMap: Map<string, StoryStats>,
  progressContent: string | null,
): StoryDisplayData[] {
  return epic.userStories.map(story => {
    const statsEntry = storyStatsMap.get(story.id);
    const progressLines = progressContent
      ? filterProgressLinesForStory(progressContent, story.id, epic.id)
      : [];

    const input: StoryStateInput = {
      storyId: story.id,
      epicId: epic.id,
      passes: story.passes,
      hasStatsEntry: statsEntry !== undefined,
      statsCompleted: statsEntry?.completedAt !== null && statsEntry?.completedAt !== undefined,
      statsPassed: statsEntry?.passed ?? false,
      statsDuration: statsEntry?.durationFormatted ?? null,
      progressLines,
    };

    const result = determineStoryState(input);

    return {
      id: story.id,
      title: story.title,
      state: result.state,
      failureReason: result.failureReason,
      duration: result.duration,
    };
  });
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
 *
 * @param prdContent - Raw prd.json content (or null)
 * @param progressContent - Raw progress.txt content (or null)
 * @param statsContent - Raw ralph-run-stats.json content (or null)
 * @param projectName - Fallback project name when prd.json has no project field
 * @param activityMap - Map from epicId to current activity string (from log polling)
 */
export function buildStateFromFiles(
  prdContent: string | null,
  progressContent: string | null,
  statsContent: string | null,
  projectName: string,
  activityMap: Map<string, string> = new Map(),
): DashboardState {
  let statsData: RunStats | null = null;
  if (statsContent) {
    try {
      statsData = JSON.parse(statsContent) as RunStats;
    } catch {
      // ignore
    }
  }

  // Extract per-story averages from estimates for per-epic projections
  const avgCostPerStory = statsData?.estimates?.averageCostPerStory ?? null;
  const avgTimePerStoryMs = statsData?.estimates?.averageTimePerStoryMs ?? null;

  const statsEpics = statsData?.epics ?? [];
  const epics = prdContent
    ? parseEpicsFromPrd(
        prdContent,
        statsEpics,
        progressContent,
        activityMap,
        avgCostPerStory,
        avgTimePerStoryMs,
      )
    : [];

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

  // Estimate fields from run stats
  const totalCostEstimate = statsData?.estimates?.estimatedTotalCostUsd ?? null;
  const totalTimeEstimate = statsData?.estimates?.estimatedTotalTimeFormatted ?? null;

  // Merge events parsed from progress.txt
  const mergeEvents = progressContent ? parseMergeEvents(progressContent) : [];

  return {
    projectName: resolvedProjectName,
    currentWave,
    startedAt,
    epics,
    totalCostUsd,
    totalCostEstimate,
    totalElapsed,
    totalTimeEstimate,
    viewMode: 'dashboard',
    selectedEpicId: null,
    rawLogLines: [],
    mergeEvents,
  };
}

/**
 * Creates a polling engine that reads data files and calls onUpdate.
 * Uses mtime caching to avoid re-parsing unchanged files.
 *
 * Also polls epic log files on every tick to update currentActivity for
 * active epics. Log polling always runs (no mtime gate) since logs grow
 * continuously and we always want the latest tail.
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

  // Activity state: always re-polled since logs grow continuously
  const activityMap = new Map<string, string>();

  // Resolve injectable helpers with fallbacks
  const doReadLogTail = deps.readLogTail ?? readLogTail;
  const doFindLatestEpicLog = deps.findLatestEpicLog ?? findLatestEpicLog;
  const backend = deps.backend ?? 'claude';

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

  /**
   * Polls the log file for each epic whose status is 'pending' (actively running).
   * Updates activityMap in place. Returns true if any activity changed.
   */
  function pollActivityFromLogs(): boolean {
    if (!cachedPrd) return false;

    let prd: Prd;
    try {
      prd = JSON.parse(cachedPrd) as Prd;
    } catch {
      return false;
    }

    let anyChanged = false;
    for (const epic of prd.epics ?? []) {
      // Only poll active (pending/partial) epics
      if (epic.status !== 'pending' && epic.status !== 'partial') continue;

      const logFile = doFindLatestEpicLog(options.logsDir, epic.id);
      if (!logFile) continue;

      const tail = doReadLogTail(logFile, 50);
      const activity = parseLatestActivity(tail, backend);
      const previous = activityMap.get(epic.id);
      if (previous !== activity) {
        activityMap.set(epic.id, activity);
        anyChanged = true;
      }
    }
    return anyChanged;
  }

  function poll(): void {
    const prdResult = readIfChanged(options.prdPath, mtimes.prd, cachedPrd);
    const progressResult = readIfChanged(options.progressPath, mtimes.progress, cachedProgress);
    const statsResult = readIfChanged(options.statsPath, mtimes.stats, cachedStats);

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

    const fileChanged = prdResult.changed || progressResult.changed || statsResult.changed;

    // Always poll logs for active epics (spinner needs to advance each tick)
    const activityChanged = pollActivityFromLogs();

    if (fileChanged || activityChanged) {
      const state = buildStateFromFiles(
        cachedPrd,
        cachedProgress,
        cachedStats,
        '(loading...)',
        new Map(activityMap), // snapshot to avoid mutation during render
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
