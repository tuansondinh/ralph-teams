import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, spawn, SpawnSyncReturns, ChildProcess } from 'child_process';
import * as readline from 'readline/promises';
import chalk from 'chalk';
import { loadConfig, mergeCliOverrides } from '../config';
import { startDashboard, resolveDashboardOptions, RetryController } from '../dashboard';
import { gatherDiscussContext, runDiscussSession } from '../discuss';
import { resetFailedEpics } from '../retry-controller';

interface RunDeps {
  existsSync: typeof fs.existsSync;
  chmodSync: typeof fs.chmodSync;
  spawnSync: typeof spawnSync;
  spawn: typeof spawn;
  exit: (code?: number) => never;
  cwd: () => string;
  /** Override for config loading — used in tests to inject a mock loader. */
  loadConfig?: typeof loadConfig;
}

const defaultDeps: RunDeps = {
  existsSync: fs.existsSync,
  chmodSync: fs.chmodSync,
  spawnSync,
  spawn,
  exit: (code?: number) => process.exit(code),
  cwd: () => process.cwd(),
  loadConfig,
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

function getCurrentGitBranch(deps: RunDeps): string | null {
  const result = deps.spawnSync('git', ['branch', '--show-current'], {
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    return null;
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  return stdout === '' ? null : stdout;
}

function hasDirtyGitWorktree(deps: RunDeps): boolean {
  const unstaged = deps.spawnSync('git', ['diff', '--quiet']);
  if (unstaged.status !== 0) {
    return true;
  }

  const staged = deps.spawnSync('git', ['diff', '--cached', '--quiet']);
  return staged.status !== 0;
}

async function promptForAutoCommit(targetBranch: string, deps: RunDeps): Promise<boolean> {
  console.log(`Worktree has uncommitted changes and Ralph needs to create or switch to branch '${targetBranch}'.`);
  console.log('Ralph will now stage and commit all current changes before the run.');

  const statusResult = deps.spawnSync('git', ['status', '--short'], {
    encoding: 'utf-8',
  });
  if (statusResult.status === 0 && typeof statusResult.stdout === 'string' && statusResult.stdout.trim() !== '') {
    process.stdout.write(statusResult.stdout);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question('Proceed with auto-commit before continuing? [y/N]: ');
    const normalized = answer.trim().toLowerCase();
    if (normalized !== 'y' && normalized !== 'yes') {
      return false;
    }
  } finally {
    rl.close();
  }

  const addResult = deps.spawnSync('git', ['add', '-A'], {
    stdio: 'inherit',
  });
  if (addResult.status !== 0) {
    console.error(chalk.red('Error: failed to stage changes before starting Ralph.'));
    deps.exit(addResult.status ?? 1);
  }

  const commitResult = deps.spawnSync('git', ['commit', '-m', 'chore: auto-commit changes before ralph run'], {
    stdio: 'inherit',
  });
  if (commitResult.status !== 0) {
    console.error(chalk.red('Error: failed to auto-commit changes before starting Ralph.'));
    deps.exit(commitResult.status ?? 1);
  }

  return true;
}

/**
 * Spawns ralph.sh as a child process with piped stdio.
 * Extracted so it can be reused for retry rounds.
 */
function spawnRalph(
  ralphSh: string,
  args: string[],
  spawnEnv: NodeJS.ProcessEnv,
  deps: RunDeps,
): ChildProcess {
  return deps.spawn(ralphSh, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: spawnEnv,
  });
}

export async function runCommand(
  prdPath: string,
  options: { backend?: string; parallel?: string; dashboard?: boolean },
  deps: RunDeps = defaultDeps,
): Promise<void> {
  const resolved = path.resolve(prdPath);
  const parallel = options.parallel;
  const useDashboard = options.dashboard === true;

  if (!deps.existsSync(resolved)) {
    console.error(chalk.red(`Error: prd.json not found at ${resolved}`));
    console.error(chalk.dim('Run `ralph-teams init` to create one.'));
    deps.exit(1);
  }

  // Load ralph.config.yml (if present) and merge CLI overrides
  const configLoader = deps.loadConfig ?? loadConfig;
  let config;
  try {
    const baseConfig = configLoader(deps.cwd());
    const parallelNum = parallel !== undefined ? parseParallel(parallel) : undefined;
    config = mergeCliOverrides(baseConfig, {
      ...(options.backend !== undefined ? { backend: options.backend } : {}),
      ...(parallelNum !== null && parallelNum !== undefined ? { parallel: parallelNum } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${msg}`));
    deps.exit(1);
  }

  // config is always defined here (exit called on error), but TypeScript needs this assertion
  const resolvedConfig = config!;
  const backend = resolvedConfig.execution.backend;
  const currentBranch = getCurrentGitBranch(deps);

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

  if (backend === 'codex' && !isCommandInstalled('codex', deps)) {
    console.error(chalk.red('Error: codex CLI is not installed or not in PATH.'));
    console.error(chalk.dim('Install Codex CLI: https://developers.openai.com/codex/'));
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

  // Pass config values to ralph.sh via environment variables
  const spawnEnv: NodeJS.ProcessEnv = {
    ...process.env,
    RALPH_EPIC_TIMEOUT: String(resolvedConfig.timeouts.epicTimeout),
    RALPH_IDLE_TIMEOUT: String(resolvedConfig.timeouts.idleTimeout),
    RALPH_VALIDATOR_MAX_PUSHBACKS: String(resolvedConfig.execution.validatorMaxPushbacks),
    RALPH_PARALLEL: String(resolvedConfig.execution.parallel),
    RALPH_BACKEND: resolvedConfig.execution.backend,
  };

  if (useDashboard && currentBranch !== null && hasDirtyGitWorktree(deps)) {
    const confirmed = await promptForAutoCommit(`a new Ralph loop branch from '${currentBranch}'`, deps);
    if (!confirmed) {
      console.log('Aborted: user declined auto-commit before run.');
      deps.exit(1);
    }
  }

  if (!useDashboard) {
    // Default: fall back to synchronous spawnSync with stdio:inherit
    const result = deps.spawnSync(ralphSh, args, {
      stdio: 'inherit',
      shell: false,
      env: spawnEnv,
    });

    deps.exit(result.status ?? 1);
  } else {
    // --dashboard: launch async with piped stdio and start dashboard
    const dashboardOptions = resolveDashboardOptions(resolved, deps.cwd(), backend);
    const cwd = deps.cwd();

    const postRunCallbacks = {
      onDiscuss: (storyId: string) => {
        // Stop the dashboard screen temporarily so readline can take over the terminal
        dashboard.stop();

        // Gather context from prd.json, progress.txt, plans/, and worktrees/
        const progressPath = path.join(cwd, 'progress.txt');
        const plansDir = path.join(cwd, 'plans');

        // Find the epic ID from the story ID so we can locate the correct worktree
        const prd = fs.existsSync(resolved)
          ? (() => {
              try {
                return JSON.parse(fs.readFileSync(resolved, 'utf-8')) as {
                  epics: Array<{ id: string; userStories: Array<{ id: string }> }>;
                };
              } catch {
                return { epics: [] };
              }
            })()
          : { epics: [] };

        let epicId = '';
        for (const epic of prd.epics) {
          if (epic.userStories.some(s => s.id === storyId)) {
            epicId = epic.id;
            break;
          }
        }

        const worktreeDir = epicId
          ? path.join(cwd, '.worktrees', epicId)
          : cwd;

        const context = gatherDiscussContext(
          storyId,
          resolved,
          progressPath,
          plansDir,
          worktreeDir,
        );

        // Run the interactive discuss session (async, but we fire-and-forget here)
        // The dashboard was already stopped above so readline can use the terminal
        const guidanceDir = path.join(cwd, 'guidance');
        runDiscussSession(context, { guidanceDir }).then(() => {
          // After the session, exit cleanly — user can restart the dashboard if needed
          deps.exit(0);
        }).catch((err: Error) => {
          console.error(chalk.red(`Discuss session error: ${err.message}`));
          deps.exit(1);
        });
      },

      onRetry: () => {
        // Retry is handled by re-running ralph — just exit for now
        dashboard.stop();
        deps.exit(0);
      },

      onQuit: () => {
        dashboard.stop();
        deps.exit(0);
      },
    };

    // Track the active child process so we can terminate it on retry.
    let activeChild: ChildProcess | null = null;
    let retrying = false;

    /**
     * Attaches close/error handlers to a ralph child process.
     * On close: if a retry is in progress the handler is a no-op (the
     * retry spawned a new child already). Otherwise exit.
     */
    function wireChild(child: ChildProcess): void {
      activeChild = child;

      child.on('close', (code: number | null) => {
        // If a retry round just started, this is the old child finishing — ignore.
        if (retrying) {
          retrying = false;
          return;
        }
        dashboard.stop();
        deps.exit(code ?? 0);
      });

      child.on('error', (err: Error) => {
        if (retrying) return;
        dashboard.stop();
        console.error(chalk.red(`Error: ${err.message}`));
        deps.exit(1);
      });
    }

    const retryController: RetryController = {
      retryFailed() {
        retrying = true;
        // Reset failed/partial epics in the PRD so ralph re-processes them
        try {
          resetFailedEpics(resolved);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`Retry: failed to reset PRD: ${msg}`));
          retrying = false;
          return;
        }
        // Terminate the old child process if it's still running
        if (activeChild && !activeChild.killed) {
          activeChild.kill();
        }
        // Spawn a new ralph round
        const newChild = spawnRalph(ralphSh!, args, spawnEnv, deps);
        wireChild(newChild);
      },

      isRetrying() {
        return retrying;
      },
    };

    const dashboard = startDashboard(dashboardOptions, postRunCallbacks, retryController);

    const initialChild = spawnRalph(ralphSh!, args, spawnEnv, deps);
    wireChild(initialChild);
  }
}
