import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import chalk from 'chalk';

interface RunDeps {
  existsSync: typeof fs.existsSync;
  chmodSync: typeof fs.chmodSync;
  spawnSync: typeof spawnSync;
  exit: (code?: number) => never;
  cwd: () => string;
}

const defaultDeps: RunDeps = {
  existsSync: fs.existsSync,
  chmodSync: fs.chmodSync,
  spawnSync,
  exit: (code?: number) => process.exit(code),
  cwd: () => process.cwd(),
};

function findRalphSh(deps: RunDeps): string | null {
  // When installed as a package, ralph.sh is bundled at the package root
  // __dirname will be dist/commands/, so package root is two levels up
  const candidates = [
    path.resolve(__dirname, '../../ralph.sh'),
    path.resolve(__dirname, '../ralph.sh'),
    path.resolve(deps.cwd(), 'ralph.sh'),
  ];

  for (const candidate of candidates) {
    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isCommandInstalled(cmd: string, deps: RunDeps): boolean {
  const result = deps.spawnSync('command', ['-v', cmd], { shell: true });
  return result.status === 0;
}

function parseParallel(parallel: string): number | null {
  if (!/^\d+$/.test(parallel)) {
    return null;
  }

  return parseInt(parallel, 10);
}

export function runCommand(prdPath: string, options: { backend?: string; parallel?: string }, deps: RunDeps = defaultDeps): void {
  const resolved = path.resolve(prdPath);
  const backend = options.backend || 'claude';
  const parallel = options.parallel;

  if (!deps.existsSync(resolved)) {
    console.error(chalk.red(`Error: prd.json not found at ${resolved}`));
    console.error(chalk.dim('Run `ralph-teams init` to create one.'));
    deps.exit(1);
  }

  if (backend === 'claude' && !isCommandInstalled('claude', deps)) {
    console.error(chalk.red('Error: claude CLI is not installed or not in PATH.'));
    console.error(chalk.dim('Install Claude Code: https://claude.ai/code'));
    deps.exit(1);
  }

  if (backend === 'copilot' && !isCommandInstalled('gh', deps)) {
    console.error(chalk.red('Error: gh CLI is not installed or not in PATH.'));
    console.error(chalk.dim('Install GitHub CLI: https://cli.github.com'));
    deps.exit(1);
  }

  const ralphSh = findRalphSh(deps);
  if (!ralphSh) {
    console.error(chalk.red('Error: ralph.sh not found. Cannot run.'));
    deps.exit(1);
  }

  // Ensure ralph.sh is executable
  try {
    deps.chmodSync(ralphSh, 0o755);
  } catch {
    // ignore chmod errors
  }

  console.log(chalk.dim(`Using PRD: ${resolved}`));
  console.log(chalk.dim(`Using backend: ${backend}`));
  console.log(chalk.dim(`Using ralph.sh: ${ralphSh}`));
  if (parallel !== undefined) {
    const parallelCount = parseParallel(parallel);
    if (parallelCount === null) {
      console.error(chalk.red('Error: --parallel must be a whole number'));
      deps.exit(1);
    }

    if (parallelCount <= 0) {
      console.error(chalk.red('Error: --parallel must be greater than 0'));
      deps.exit(1);
    }

    console.log(chalk.dim(`Parallel: ${parallelCount} epics per wave\n`));
  } else {
    console.log(chalk.dim('Mode: sequential\n'));
  }

  const args = [resolved, '--backend', backend];
  if (parallel !== undefined) {
    const parallelCount = parseParallel(parallel);
    if (parallelCount === null || parallelCount <= 0) {
      deps.exit(1);
    }

    args.push('--parallel', String(parallelCount));
  }
  const result = deps.spawnSync(ralphSh, args, {
    stdio: 'inherit',
    shell: false,
  });

  deps.exit(result.status ?? 1);
}
