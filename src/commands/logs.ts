import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

function colorizeLine(line: string): string {
  // Wave boundaries (highest priority — check before PASS/FAIL substring matches)
  if (/^===\s+Wave\s+\d+/.test(line)) return chalk.cyan.bold(line);
  // Merge results
  if (line.includes('MERGE FAILED')) return chalk.red(line);
  if (line.includes('MERGED')) return chalk.blue(line);
  // Pass/fail outcomes
  if (line.includes('PASS')) return chalk.green(line);
  if (line.includes('FAIL')) return chalk.red(line);
  // Section headers
  if (line.startsWith('##')) return chalk.yellow(line);
  return line;
}

function splitLogEntries(content: string): string[] {
  const lines = content.split('\n');
  const waveEntries: string[] = [];
  let currentWave: string[] = [];

  for (const line of lines) {
    if (/^===\s+Wave\s+\d+/.test(line)) {
      if (currentWave.length > 0) {
        waveEntries.push(currentWave.join('\n').trimEnd());
      }
      currentWave = [line];
      continue;
    }

    if (currentWave.length > 0) {
      currentWave.push(line);
    }
  }

  if (currentWave.length > 0) {
    waveEntries.push(currentWave.join('\n').trimEnd());
  }

  if (waveEntries.length > 0) {
    return waveEntries;
  }

  const separator = '\n---\n';
  if (content.includes(separator)) {
    return content.split(separator).map((entry) => entry.trim()).filter((entry) => entry !== '');
  }

  const trimmed = content.trim();
  return trimmed === '' ? [] : [trimmed];
}

export function logsCommand(options: { tail?: string }): void {
  const logPath = path.resolve('./progress.txt');

  if (!fs.existsSync(logPath)) {
    console.log(chalk.yellow('No progress.txt found. Run an epic first to generate logs.'));
    return;
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  let output = content;

  if (options.tail !== undefined) {
    const n = parseInt(options.tail, 10);
    if (isNaN(n) || n <= 0) {
      console.error(chalk.red('Error: --tail must be a positive integer'));
      process.exit(1);
    }
    const entries = splitLogEntries(content);
    output = entries.slice(-n).join('\n\n');
  }

  const lines = output.split('\n');
  for (const line of lines) {
    console.log(colorizeLine(line));
  }
}
