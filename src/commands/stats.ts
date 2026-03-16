import * as fs from 'node:fs';
import chalk from 'chalk';
import { loadRunStats, RunStats } from '../run-stats';

/** Injectable dependencies for testability. */
export interface StatsDeps {
  loadRunStats: typeof loadRunStats;
  existsSync: typeof fs.existsSync;
  log: (msg: string) => void;
}

const defaultDeps: StatsDeps = {
  loadRunStats,
  existsSync: fs.existsSync,
  log: (msg: string) => console.log(msg),
};

/**
 * Formats a nullable USD cost value for display.
 * Returns '$X.XXXX' for numbers or 'n/a' for null.
 */
function fmtCost(cost: number | null): string {
  return cost !== null ? `$${cost.toFixed(4)}` : 'n/a';
}

/**
 * Formats a nullable duration string for display.
 * Returns the string or 'n/a' for null.
 */
function fmtDuration(d: string | null): string {
  return d ?? 'n/a';
}

/**
 * Implements the `ralph-teams stats` command.
 *
 * Reads ralph-run-stats.json and displays a formatted cost/token/time summary
 * covering per-epic stats, run totals, and current estimates.
 *
 * @param statsPath - Path to the ralph-run-stats.json file
 * @param deps - Injectable dependencies (defaults to real implementations)
 */
export function statsCommand(statsPath: string, deps: StatsDeps = defaultDeps): void {
  if (!deps.existsSync(statsPath)) {
    deps.log('No run stats found.');
    return;
  }

  const stats: RunStats = deps.loadRunStats(statsPath);

  deps.log('');
  deps.log(chalk.bold('Ralph Run Stats'));
  deps.log(chalk.dim(`Updated: ${stats.updatedAt}`));

  // -------------------------------------------------------------------------
  // Per-epic breakdown
  // -------------------------------------------------------------------------
  if (stats.epics.length > 0) {
    deps.log('');
    deps.log(chalk.bold('Epics:'));

    for (const epic of stats.epics) {
      const passLabel = `${epic.storiesPassed}/${epic.storiesTotal} stories passed`;
      const costLabel = fmtCost(epic.totalCostUsd);
      const durLabel = fmtDuration(epic.durationFormatted);

      deps.log(`  ${chalk.cyan(epic.epicId)}  ${passLabel}  cost: ${costLabel}  duration: ${durLabel}`);

      // Per-story detail (indented)
      for (const story of epic.stories) {
        const icon = story.passed ? chalk.green('✓') : chalk.red('✗');
        const storyDur = fmtDuration(story.durationFormatted);
        const storyCost = fmtCost(story.costUsd);
        deps.log(`    ${icon} ${story.storyId}  cost: ${storyCost}  duration: ${storyDur}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Totals
  // -------------------------------------------------------------------------
  deps.log('');
  deps.log(chalk.bold('Totals:'));
  deps.log(`  Stories:  ${stats.totals.storiesPassed}/${stats.totals.storiesTotal} passed`);
  deps.log(`  Cost:     ${fmtCost(stats.totals.costUsd)}`);
  deps.log(`  Duration: ${fmtDuration(stats.totals.durationFormatted)}`);

  // -------------------------------------------------------------------------
  // Estimates
  // -------------------------------------------------------------------------
  deps.log('');
  deps.log(chalk.bold('Estimates:'));
  deps.log(`  Est. total cost: ${stats.estimates.estimatedTotalCostUsd ?? '--'}`);
  deps.log(`  Est. total time: ${stats.estimates.estimatedTotalTimeFormatted ?? '--'}`);
  deps.log(`  Stories remaining: ${stats.estimates.storiesRemaining}`);

  if (stats.estimates.averageCostPerStory !== null) {
    deps.log(`  Avg cost/story:  $${stats.estimates.averageCostPerStory.toFixed(4)}`);
  }
  if (stats.estimates.averageTimePerStoryMs !== null) {
    const avgSecs = (stats.estimates.averageTimePerStoryMs / 1000).toFixed(0);
    deps.log(`  Avg time/story:  ${avgSecs}s`);
  }

  deps.log('');
}
