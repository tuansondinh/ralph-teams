import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadPrd, epicStatusColor } from '../prd-utils';
import { getRalphProgressPath } from '../runtime-paths';

/** A single wave's worth of data parsed from progress.txt */
export interface WaveInfo {
  waveNumber: number;
  epicIds: string[];
  results: Array<{ epicId: string; outcome: string }>;
}

/**
 * Parse wave boundaries and results from progress.txt.
 * Returns an empty array if the file does not exist or contains no wave data.
 *
 * Expected progress.txt format (written by ralph.sh):
 *   === Wave N — <date> ===
 *     EPIC-XXX
 *     EPIC-YYY
 *   [EPIC-XXX] OUTCOME — <date>
 */
export function parseWavesFromProgress(progressPath: string): WaveInfo[] {
  if (!fs.existsSync(progressPath)) {
    return [];
  }

  const lines = fs.readFileSync(progressPath, 'utf-8').split('\n');
  const waves: WaveInfo[] = [];
  let currentWave: WaveInfo | null = null;
  let inWaveHeader = false; // true immediately after a wave header line

  // Matches: === Wave 3 — Mon Jan 01 ... ===
  const waveHeaderRe = /^===\s+Wave\s+(\d+)/;
  // Matches indented epic IDs that follow the wave header (before any result lines)
  const epicIdRe = /^\s{1,4}(EPIC-\d+)\s*$/;
  // Matches result lines: [EPIC-XXX] OUTCOME — date [— detail]
  const resultRe = /^\[(EPIC-\d+)\]\s+(.+)$/;

  for (const line of lines) {
    const waveMatch = waveHeaderRe.exec(line);
    if (waveMatch) {
      currentWave = { waveNumber: parseInt(waveMatch[1], 10), epicIds: [], results: [] };
      waves.push(currentWave);
      inWaveHeader = true;
      continue;
    }

    if (currentWave && inWaveHeader) {
      const epicMatch = epicIdRe.exec(line);
      if (epicMatch) {
        currentWave.epicIds.push(epicMatch[1]);
        continue;
      }
      // A non-blank, non-epic line ends the header section
      if (line.trim() !== '') {
        inWaveHeader = false;
      }
    }

    const resultMatch = resultRe.exec(line);
    if (resultMatch && currentWave) {
      currentWave.results.push({ epicId: resultMatch[1], outcome: parseResultOutcome(resultMatch[2]) });
    }
  }

  return waves;
}

export function summaryCommand(prdPath: string): void {
  const { prd } = loadPrd(prdPath);

  // Build status map for blocked checking
  const statusMap = new Map<string, string>();
  for (const epic of prd.epics) {
    statusMap.set(epic.id, epic.status);
  }

  // Print project header
  if (prd.project) {
    console.log(chalk.bold(`\nProject: ${prd.project}`));
  }

  // Print dependency arrows section
  console.log(chalk.bold('\nDependencies:'));
  let hasDeps = false;
  for (const epic of prd.epics) {
    for (const dep of epic.dependsOn ?? []) {
      console.log(chalk.dim(`  ${dep} → ${epic.id}`));
      hasDeps = true;
    }
  }
  if (!hasDeps) {
    console.log(chalk.dim('  (no dependencies)'));
  }

  // Print epic list with details
  console.log(chalk.bold('\nEpics:'));
  for (const epic of prd.epics) {
    const total = epic.userStories.length;
    const passed = epic.userStories.filter(s => s.passes).length;

    // Determine if blocked
    const deps = epic.dependsOn ?? [];
    const isBlocked = deps.some(dep => statusMap.get(dep) !== 'completed');

    // Pass rate color
    let passRateStr: string;
    if (total === 0) {
      passRateStr = chalk.dim('0/0 passed');
    } else if (passed === total) {
      passRateStr = chalk.green(`${passed}/${total} passed`);
    } else if (passed === 0) {
      passRateStr = chalk.red(`${passed}/${total} passed`);
    } else {
      passRateStr = chalk.yellow(`${passed}/${total} passed`);
    }

    // Dependency annotation
    const depAnnotation = deps.length > 0
      ? chalk.dim(` ← ${deps.join(', ')}`)
      : '';
    const planningAnnotation = epic.planned ? chalk.green('planned') : chalk.yellow('unplanned');

    // Blocked label
    const blockedLabel = isBlocked ? `  ${chalk.red.bold('⚠ BLOCKED')}` : '';

    const statusStr = epicStatusColor(epic.status);
    const epicLabel = `${chalk.bold(epic.id)}: ${epic.title}${depAnnotation}`;
    const statusPadded = `[${statusStr}]`;

    console.log(`  ${epicLabel}  ${statusPadded}  ${planningAnnotation}  ${passRateStr}${blockedLabel}`);
  }

  // Wave History — parsed from progress.txt if present
  const progressPath = getRalphProgressPath(path.resolve('.'));
  const waves = parseWavesFromProgress(progressPath);
  if (waves.length > 0) {
    console.log(chalk.bold('\nWave History:'));
    for (const wave of waves) {
      const epicList = wave.epicIds.length > 0 ? wave.epicIds.join(', ') : '(none)';
      console.log(`  ${chalk.cyan.bold(`Wave ${wave.waveNumber}:`)} ${epicList} (${wave.epicIds.length} epic${wave.epicIds.length !== 1 ? 's' : ''})`);
      for (const result of wave.results) {
        const outcomeStr = formatOutcome(result.outcome);
        console.log(`    ${chalk.bold(result.epicId)}: ${outcomeStr}`);
      }
    }
  }

  console.log('');
}

/** Colorize an outcome string from progress.txt */
function formatOutcome(outcome: string): string {
  if (outcome.startsWith('PASSED')) return chalk.green(outcome);
  if (outcome.startsWith('MERGED')) return chalk.blue(outcome);
  if (outcome.startsWith('MERGE FAILED')) return chalk.red(outcome);
  if (outcome.startsWith('FAILED')) return chalk.red(outcome);
  if (outcome.startsWith('FAIL')) return chalk.red(outcome);
  if (outcome.startsWith('PARTIAL')) return chalk.yellow(outcome);
  if (outcome.startsWith('SKIPPED')) return chalk.dim(outcome);
  if (outcome.startsWith('AUTO-COMPLETED')) return chalk.green(outcome);
  return outcome;
}

function parseResultOutcome(resultLine: string): string {
  const parts = resultLine.split(' — ');
  if (parts.length >= 3) {
    return parts.slice(2).join(' — ').trim();
  }

  return parts[0]?.trim() ?? resultLine.trim();
}
