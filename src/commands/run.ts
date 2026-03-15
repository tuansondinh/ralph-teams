import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import chalk from 'chalk';

function findRalphSh(): string | null {
  // When installed as a package, ralph.sh is bundled at the package root
  // __dirname will be dist/commands/, so package root is two levels up
  const candidates = [
    path.resolve(__dirname, '../../ralph.sh'),
    path.resolve(__dirname, '../ralph.sh'),
    path.resolve(process.cwd(), 'ralph.sh'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isClaudeInstalled(): boolean {
  const result = spawnSync('command', ['-v', 'claude'], { shell: true });
  return result.status === 0;
}

export function runCommand(prdPath: string): void {
  const resolved = path.resolve(prdPath);

  if (!fs.existsSync(resolved)) {
    console.error(chalk.red(`Error: prd.json not found at ${resolved}`));
    console.error(chalk.dim('Run `ralph-claude init` to create one.'));
    process.exit(1);
  }

  if (!isClaudeInstalled()) {
    console.error(chalk.red('Error: claude CLI is not installed or not in PATH.'));
    console.error(chalk.dim('Install Claude Code: https://claude.ai/code'));
    process.exit(1);
  }

  const ralphSh = findRalphSh();
  if (!ralphSh) {
    console.error(chalk.red('Error: ralph.sh not found. Cannot run.'));
    process.exit(1);
  }

  // Ensure ralph.sh is executable
  try {
    fs.chmodSync(ralphSh, 0o755);
  } catch {
    // ignore chmod errors
  }

  console.log(chalk.dim(`Using PRD: ${resolved}`));
  console.log(chalk.dim(`Using ralph.sh: ${ralphSh}\n`));

  const result = spawnSync(ralphSh, [resolved], {
    stdio: 'inherit',
    shell: false,
  });

  process.exit(result.status ?? 1);
}
