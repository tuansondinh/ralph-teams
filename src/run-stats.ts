/**
 * run-stats.ts — Ralph run statistics tracking.
 *
 * Manages the `ralph-run-stats.json` file that records cost, token usage,
 * timing, and pass/fail counts at the story, epic, and total run level.
 *
 * Schema (version 1):
 * {
 *   "version": 1,
 *   "updatedAt": "<ISO 8601>",
 *   "epics": [
 *     {
 *       "epicId": "EPIC-001",
 *       "stories": [ { StoryStats } ],
 *       "totalInputTokens": number | null,
 *       "totalOutputTokens": number | null,
 *       "totalCostUsd": number | null,
 *       "startedAt": "<ISO 8601>" | null,
 *       "completedAt": "<ISO 8601>" | null,
 *       "durationMs": number | null,
 *       "durationFormatted": string | null,
 *       "storiesPassed": number,
 *       "storiesTotal": number
 *     }
 *   ],
 *   "totals": {
 *     "inputTokens": number | null,
 *     "outputTokens": number | null,
 *     "costUsd": number | null,
 *     "storiesPassed": number,
 *     "storiesTotal": number,
 *     "startedAt": "<ISO 8601>" | null,
 *     "durationMs": number | null,
 *     "durationFormatted": string | null
 *   },
 *   "estimates": {
 *     "estimatedTotalCostUsd": string | null,
 *     "estimatedTotalTimeMs": number | null,
 *     "estimatedTotalTimeFormatted": string | null,
 *     "averageCostPerStory": number | null,
 *     "averageTimePerStoryMs": number | null,
 *     "storiesRemaining": number
 *   }
 * }
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TokenUsage } from './token-parser';
import { RalphConfig } from './config';
import { formatDuration } from './time-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-story cost, token, and timing data. */
export interface StoryStats {
  storyId: string;
  epicId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
  /** ISO 8601 timestamp when the story started (set by update-stats --started-at). */
  startedAt: string | null;
  /** ISO 8601 timestamp when the story completed. */
  completedAt: string | null;
  /** Wall-clock duration in milliseconds. */
  durationMs: number | null;
  /** Human-readable duration, e.g. "4m 32s". */
  durationFormatted: string | null;
  passed: boolean;
}

/** Aggregated stats for one epic (sum of all its stories). */
export interface EpicStats {
  epicId: string;
  stories: StoryStats[];
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCostUsd: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  durationFormatted: string | null;
  storiesPassed: number;
  storiesTotal: number;
}

/** Top-level run stats file structure. */
export interface RunStats {
  version: 1;
  updatedAt: string;
  epics: EpicStats[];
  totals: {
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    storiesPassed: number;
    storiesTotal: number;
    startedAt: string | null;
    durationMs: number | null;
    durationFormatted: string | null;
  };
  estimates: {
    estimatedTotalCostUsd: string | null;
    estimatedTotalTimeMs: number | null;
    estimatedTotalTimeFormatted: string | null;
    averageCostPerStory: number | null;
    averageTimePerStoryMs: number | null;
    storiesRemaining: number;
  };
}

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------

/**
 * Calculates the USD cost for a set of token counts using the given pricing config.
 *
 * Returns null if all token counts are null (no data available).
 * Any individual null token field is treated as 0 for the cost calculation.
 *
 * @param usage - Token counts from parseTokenUsageFromLog/File
 * @param pricing - Model pricing rates from RalphConfig
 * @returns USD cost, or null if all tokens are null
 */
export function calculateCost(
  usage: TokenUsage,
  pricing: RalphConfig['pricing'],
): number | null {
  const { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens } = usage;

  // If every field is null, there is no data to price
  if (
    inputTokens === null &&
    outputTokens === null &&
    cacheCreationInputTokens === null &&
    cacheReadInputTokens === null
  ) {
    return null;
  }

  const cost =
    ((inputTokens ?? 0) / 1000) * pricing.inputTokenCostPer1k +
    ((outputTokens ?? 0) / 1000) * pricing.outputTokenCostPer1k +
    ((cacheReadInputTokens ?? 0) / 1000) * pricing.cacheReadCostPer1k +
    ((cacheCreationInputTokens ?? 0) / 1000) * pricing.cacheCreationCostPer1k;

  return cost;
}

// ---------------------------------------------------------------------------
// Empty structure factory
// ---------------------------------------------------------------------------

/** Returns a default empty RunStats structure. */
export function createEmptyRunStats(): RunStats {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    epics: [],
    totals: {
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      storiesPassed: 0,
      storiesTotal: 0,
      startedAt: null,
      durationMs: null,
      durationFormatted: null,
    },
    estimates: {
      estimatedTotalCostUsd: null,
      estimatedTotalTimeMs: null,
      estimatedTotalTimeFormatted: null,
      averageCostPerStory: null,
      averageTimePerStoryMs: null,
      storiesRemaining: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/**
 * Reads the run stats file from disk.
 * Returns an empty RunStats structure if the file does not exist or cannot be parsed.
 *
 * @param statsPath - Absolute path to ralph-run-stats.json
 */
export function loadRunStats(statsPath: string): RunStats {
  if (!fs.existsSync(statsPath)) {
    return createEmptyRunStats();
  }

  try {
    const content = fs.readFileSync(statsPath, 'utf-8');
    const parsed = JSON.parse(content) as RunStats;
    return parsed;
  } catch {
    return createEmptyRunStats();
  }
}

/**
 * Writes the run stats file atomically (write to temp file, then rename).
 * The JSON is pretty-printed with 2-space indentation.
 *
 * @param statsPath - Absolute path to ralph-run-stats.json
 * @param stats - The RunStats object to persist
 */
export function saveRunStats(statsPath: string, stats: RunStats): void {
  const dir = path.dirname(statsPath);
  const tmpPath = path.join(dir, `.ralph-run-stats.json.${process.pid}.tmp`);
  const json = JSON.stringify(stats, null, 2) + '\n';
  fs.writeFileSync(tmpPath, json, 'utf-8');
  fs.renameSync(tmpPath, statsPath);
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/**
 * Sums nullable numbers. Returns null if all inputs are null, otherwise sums
 * treating null values as 0.
 */
function sumNullable(...values: (number | null)[]): number | null {
  const hasAny = values.some(v => v !== null);
  if (!hasAny) return null;
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

/**
 * Returns the earliest non-null ISO 8601 timestamp from an array, or null if none.
 */
function minIso(timestamps: (string | null)[]): string | null {
  const valid = timestamps.filter((t): t is string => t !== null);
  if (valid.length === 0) return null;
  return valid.reduce((min, t) => (t < min ? t : min));
}

/**
 * Returns the latest non-null ISO 8601 timestamp from an array, or null if none.
 */
function maxIso(timestamps: (string | null)[]): string | null {
  const valid = timestamps.filter((t): t is string => t !== null);
  if (valid.length === 0) return null;
  return valid.reduce((max, t) => (t > max ? t : max));
}

/**
 * Derives durationMs and durationFormatted from ISO 8601 start/end timestamps.
 * Returns null for both if either timestamp is missing.
 */
function deriveDuration(startedAt: string | null, completedAt: string | null): {
  durationMs: number | null;
  durationFormatted: string | null;
} {
  if (startedAt === null || completedAt === null) {
    return { durationMs: null, durationFormatted: null };
  }
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return { durationMs: null, durationFormatted: null };
  return { durationMs: ms, durationFormatted: formatDuration(ms) };
}

/**
 * Builds an EpicStats object from a list of StoryStats, summing token counts,
 * cost, and pass counts. Time fields are derived from min(startedAt) and
 * max(completedAt) across all stories.
 *
 * @param epicId - The epic identifier
 * @param stories - All stories belonging to this epic
 */
export function aggregateEpicStats(epicId: string, stories: StoryStats[]): EpicStats {
  const totalInputTokens = sumNullable(...stories.map(s => s.inputTokens));
  const totalOutputTokens = sumNullable(...stories.map(s => s.outputTokens));
  const totalCostUsd = sumNullable(...stories.map(s => s.costUsd));
  const storiesPassed = stories.filter(s => s.passed).length;

  const startedAt = minIso(stories.map(s => s.startedAt));
  const completedAt = maxIso(stories.map(s => s.completedAt));
  const { durationMs, durationFormatted } = deriveDuration(startedAt, completedAt);

  return {
    epicId,
    stories,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    startedAt,
    completedAt,
    durationMs,
    durationFormatted,
    storiesPassed,
    storiesTotal: stories.length,
  };
}

/**
 * Sums all epic-level stats into total run-level aggregates.
 * Time fields are derived from min(epic.startedAt) and max(epic.completedAt).
 *
 * @param epics - All EpicStats in the run
 */
export function aggregateTotalStats(epics: EpicStats[]): RunStats['totals'] {
  const inputTokens = sumNullable(...epics.map(e => e.totalInputTokens));
  const outputTokens = sumNullable(...epics.map(e => e.totalOutputTokens));
  const costUsd = sumNullable(...epics.map(e => e.totalCostUsd));
  const storiesPassed = epics.reduce((sum, e) => sum + e.storiesPassed, 0);
  const storiesTotal = epics.reduce((sum, e) => sum + e.storiesTotal, 0);

  const startedAt = minIso(epics.map(e => e.startedAt));
  const completedAt = maxIso(epics.map(e => e.completedAt));
  const { durationMs, durationFormatted } = deriveDuration(startedAt, completedAt);

  return {
    inputTokens,
    outputTokens,
    costUsd,
    storiesPassed,
    storiesTotal,
    startedAt,
    durationMs,
    durationFormatted,
  };
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

/**
 * Calculates running cost and time estimates based on completed story averages.
 *
 * Formula: estimatedTotal = actualCostSoFar + (avgCostPerStory * storiesRemaining)
 * Same formula applied to time.
 *
 * Before any story with cost data completes, returns '--' strings and null numerics.
 *
 * @param stats - Current RunStats (after latest update)
 * @param totalStoriesInRun - Total number of stories across all epics in this run
 */
export function calculateEstimates(stats: RunStats, totalStoriesInRun: number): RunStats['estimates'] {
  // Only stories with cost data count toward the average
  const completedStories = stats.epics.flatMap(e => e.stories).filter(s => s.costUsd !== null);
  const completedCount = completedStories.length;

  if (completedCount === 0) {
    return {
      estimatedTotalCostUsd: '--',
      estimatedTotalTimeMs: null,
      estimatedTotalTimeFormatted: '--',
      averageCostPerStory: null,
      averageTimePerStoryMs: null,
      storiesRemaining: totalStoriesInRun,
    };
  }

  const totalCostSoFar = completedStories.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const avgCost = totalCostSoFar / completedCount;
  const remaining = Math.max(0, totalStoriesInRun - completedCount);
  const estimatedTotal = totalCostSoFar + (avgCost * remaining);

  // Time estimates — only stories that have durationMs contribute
  const storiesWithTime = completedStories.filter(s => s.durationMs !== null);
  let avgTime: number | null = null;
  let estimatedTimeMs: number | null = null;
  let estimatedTimeFormatted: string | null = '--';

  if (storiesWithTime.length > 0) {
    const totalTimeSoFar = storiesWithTime.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    avgTime = totalTimeSoFar / storiesWithTime.length;
    estimatedTimeMs = totalTimeSoFar + (avgTime * remaining);
    estimatedTimeFormatted = formatDuration(estimatedTimeMs);
  }

  return {
    estimatedTotalCostUsd: `$${estimatedTotal.toFixed(2)}`,
    estimatedTotalTimeMs: estimatedTimeMs,
    estimatedTotalTimeFormatted: estimatedTimeFormatted,
    averageCostPerStory: avgCost,
    averageTimePerStoryMs: avgTime,
    storiesRemaining: remaining,
  };
}

// ---------------------------------------------------------------------------
// Update entry point
// ---------------------------------------------------------------------------

/**
 * Adds or updates a story entry in the RunStats, then recalculates epic and
 * total aggregates. Returns a new RunStats object (does not mutate input).
 *
 * If a story with the same (epicId, storyId) already exists, it is replaced.
 *
 * @param stats - Current RunStats (from loadRunStats)
 * @param storyStats - New or updated story data to upsert
 * @param totalStoriesInRun - Total stories across all epics (for estimate calculation).
 *   If omitted, defaults to the number of stories already tracked in the stats.
 */
export function updateStoryStats(stats: RunStats, storyStats: StoryStats, totalStoriesInRun?: number): RunStats {
  const { epicId, storyId } = storyStats;

  // Find or create the epic entry
  let epicEntry = stats.epics.find(e => e.epicId === epicId);

  if (!epicEntry) {
    // New epic — create a placeholder
    epicEntry = aggregateEpicStats(epicId, []);
    stats = { ...stats, epics: [...stats.epics, epicEntry] };
  }

  // Upsert the story inside the epic
  const existingIndex = epicEntry.stories.findIndex(s => s.storyId === storyId);
  let updatedStories: StoryStats[];

  if (existingIndex >= 0) {
    updatedStories = epicEntry.stories.map((s, i) => (i === existingIndex ? storyStats : s));
  } else {
    updatedStories = [...epicEntry.stories, storyStats];
  }

  // Recalculate epic aggregates (time fields derived from story timestamps)
  const mergedEpic = aggregateEpicStats(epicId, updatedStories);

  const updatedEpics = stats.epics.map(e => (e.epicId === epicId ? mergedEpic : e));

  // Recalculate totals (time fields derived from epic timestamps)
  const mergedTotals = aggregateTotalStats(updatedEpics);

  // Build an intermediate stats object to pass to calculateEstimates
  const intermediate: RunStats = {
    ...stats,
    updatedAt: new Date().toISOString(),
    epics: updatedEpics,
    totals: mergedTotals,
  };

  // Count total stories: use provided value, else fall back to stories already tracked
  const allTrackedStories = updatedEpics.flatMap(e => e.stories).length;
  const storiesTotalForEstimate = totalStoriesInRun ?? allTrackedStories;

  const estimates = calculateEstimates(intermediate, storiesTotalForEstimate);

  return { ...intermediate, estimates };
}
