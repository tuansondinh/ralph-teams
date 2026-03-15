import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

function colorizeLine(line: string): string {
  if (line.includes('PASS')) return chalk.green(line);
  if (line.includes('FAIL')) return chalk.red(line);
  if (line.startsWith('##')) return chalk.yellow(line);
  return line;
}

export function logsCommand(options: { tail?: string }): void {
  const logPath = path.resolve('./progress.txt');

  if (!fs.existsSync(logPath)) {
    console.log(chalk.yellow('No progress.txt found. Run an epic first to generate logs.'));
    return;
  }

  const content = fs.readFileSync(logPath, 'utf-8');

  const separator = '\n---\n';
  let entries = content.split(separator);

  if (options.tail !== undefined) {
    const n = parseInt(options.tail, 10);
    if (isNaN(n) || n <= 0) {
      console.error(chalk.red('Error: --tail must be a positive integer'));
      process.exit(1);
    }
    entries = entries.slice(-n);
  }

  const output = entries.join(separator);
  const lines = output.split('\n');
  for (const line of lines) {
    console.log(colorizeLine(line));
  }
}
