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
 * Builds an EpicStats object from a list of StoryStats, summing token counts,
 * cost, and pass counts. Time fields are left null here (populated by US-008).
 *
 * @param epicId - The epic identifier
 * @param stories - All stories belonging to this epic
 */
export function aggregateEpicStats(epicId: string, stories: StoryStats[]): EpicStats {
  const totalInputTokens = sumNullable(...stories.map(s => s.inputTokens));
  const totalOutputTokens = sumNullable(...stories.map(s => s.outputTokens));
  const totalCostUsd = sumNullable(...stories.map(s => s.costUsd));
  const storiesPassed = stories.filter(s => s.passed).length;

  return {
    epicId,
    stories,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    durationFormatted: null,
    storiesPassed,
    storiesTotal: stories.length,
  };
}

/**
 * Sums all epic-level stats into total run-level aggregates.
 * Time fields are left null here (populated by US-008).
 *
 * @param epics - All EpicStats in the run
 */
export function aggregateTotalStats(epics: EpicStats[]): RunStats['totals'] {
  const inputTokens = sumNullable(...epics.map(e => e.totalInputTokens));
  const outputTokens = sumNullable(...epics.map(e => e.totalOutputTokens));
  const costUsd = sumNullable(...epics.map(e => e.totalCostUsd));
  const storiesPassed = epics.reduce((sum, e) => sum + e.storiesPassed, 0);
  const storiesTotal = epics.reduce((sum, e) => sum + e.storiesTotal, 0);

  return {
    inputTokens,
    outputTokens,
    costUsd,
    storiesPassed,
    storiesTotal,
    startedAt: null,
    durationMs: null,
    durationFormatted: null,
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
 */
export function updateStoryStats(stats: RunStats, storyStats: StoryStats): RunStats {
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

  // Recalculate epic aggregates, preserving any time fields already set
  const freshEpic = aggregateEpicStats(epicId, updatedStories);
  // Preserve existing time fields from the old epic entry if new ones aren't provided
  const mergedEpic: EpicStats = {
    ...freshEpic,
    startedAt: epicEntry.startedAt,
    completedAt: epicEntry.completedAt,
    durationMs: epicEntry.durationMs,
    durationFormatted: epicEntry.durationFormatted,
  };

  const updatedEpics = stats.epics.map(e => (e.epicId === epicId ? mergedEpic : e));

  // Recalculate totals, preserving existing time fields
  const freshTotals = aggregateTotalStats(updatedEpics);
  const mergedTotals: RunStats['totals'] = {
    ...freshTotals,
    startedAt: stats.totals.startedAt,
    durationMs: stats.totals.durationMs,
    durationFormatted: stats.totals.durationFormatted,
  };

  return {
    ...stats,
    updatedAt: new Date().toISOString(),
    epics: updatedEpics,
    totals: mergedTotals,
  };
}
