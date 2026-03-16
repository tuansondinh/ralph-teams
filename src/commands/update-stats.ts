import * as path from 'node:path';
import { loadConfig, DEFAULT_CONFIG } from '../config';
import { parseTokenUsageFromFile } from '../token-parser';
import { calculateCost, loadRunStats, saveRunStats, updateStoryStats, StoryStats } from '../run-stats';
import { formatDuration } from '../time-utils';

/** Options accepted by the update-stats CLI command. */
export interface UpdateStatsOptions {
  epicId: string;
  storyId: string;
  logFile: string;
  /** String "true" or "false" (as passed from shell). */
  passed: string;
  backend: string;
  /** ISO 8601 start timestamp (optional, set by US-008). */
  startedAt?: string;
  /** ISO 8601 completion timestamp (optional, set by US-008). */
  completedAt?: string;
  /** Total number of stories across all epics in this run (for estimates). */
  storiesTotal?: string;
}

/** Injectable dependencies for testability. */
export interface UpdateStatsDeps {
  loadConfig: typeof loadConfig;
  parseTokenUsageFromFile: typeof parseTokenUsageFromFile;
  loadRunStats: typeof loadRunStats;
  saveRunStats: typeof saveRunStats;
  updateStoryStats: typeof updateStoryStats;
  cwd: () => string;
  log: (msg: string) => void;
}

const defaultDeps: UpdateStatsDeps = {
  loadConfig,
  parseTokenUsageFromFile,
  loadRunStats,
  saveRunStats,
  updateStoryStats,
  cwd: () => process.cwd(),
  log: (msg: string) => console.log(msg),
};

/**
 * Implements the `ralph-teams update-stats` command.
 *
 * Reads token usage from the given log file, calculates cost using the
 * project pricing config, then upserts the story entry in ralph-run-stats.json.
 *
 * @param options - Parsed CLI options
 * @param deps - Injectable dependencies (defaults to real implementations)
 */
export function updateStatsCommand(
  options: UpdateStatsOptions,
  deps: UpdateStatsDeps = defaultDeps,
): void {
  const { epicId, storyId, logFile, passed, backend } = options;
  const cwd = deps.cwd();

  // Load pricing config (falls back to defaults if no ralph.config.yml)
  let config;
  try {
    config = deps.loadConfig(cwd);
  } catch {
    // Config errors should not break stats tracking
    config = { ...DEFAULT_CONFIG };
  }

  // Parse token usage from log file
  const tokenUsage = deps.parseTokenUsageFromFile(logFile, backend);

  // Calculate cost
  const costUsd = calculateCost(tokenUsage, config.pricing);

  // Resolve stats file path relative to cwd
  const statsPath = path.join(cwd, 'ralph-run-stats.json');

  // Load existing stats
  const existingStats = deps.loadRunStats(statsPath);

  // Calculate wall-clock duration when both timestamps are available
  const startedAt = options.startedAt ?? null;
  const completedAt = options.completedAt ?? null;
  let durationMs: number | null = null;
  let durationFormatted: string | null = null;

  if (startedAt !== null && completedAt !== null) {
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (ms >= 0) {
      durationMs = ms;
      durationFormatted = formatDuration(ms);
    }
  }

  // Build story stats entry
  const storyEntry: StoryStats = {
    storyId,
    epicId,
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    cacheCreationInputTokens: tokenUsage.cacheCreationInputTokens,
    cacheReadInputTokens: tokenUsage.cacheReadInputTokens,
    costUsd,
    startedAt,
    completedAt,
    durationMs,
    durationFormatted,
    passed: passed === 'true',
  };

  // Parse total stories for estimate calculation (optional)
  const totalStoriesInRun = options.storiesTotal !== undefined
    ? parseInt(options.storiesTotal, 10)
    : undefined;

  // Update and save
  const updatedStats = deps.updateStoryStats(existingStats, storyEntry, totalStoriesInRun);
  deps.saveRunStats(statsPath, updatedStats);

  const estimatedCost = updatedStats.estimates.estimatedTotalCostUsd;
  deps.log(`[update-stats] Updated stats for ${epicId}/${storyId} — cost: ${costUsd !== null ? `$${costUsd.toFixed(4)}` : 'n/a'} — estimated total: ${estimatedCost ?? '--'}`);
}
