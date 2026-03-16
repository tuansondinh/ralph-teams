import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { loadConfig } from '../config';

/** Shape of the saved state file written by ralph.sh on interrupt. */
interface RalphState {
  version: string;
  prdFile: string;
  backend: string;
  parallel?: number;
  currentWave?: number;
  activeEpics?: string[];
  storyProgress?: Record<string, unknown>;
  interruptedStoryId?: string;
  timestamp?: string;
}

export interface ResumeDeps {
  existsSync: typeof fs.existsSync;
  readFileSync: typeof fs.readFileSync;
  unlinkSync: typeof fs.unlinkSync;
  chmodSync: typeof fs.chmodSync;
  spawnSync: typeof spawnSync;
  exit: (code?: number) => never;
  cwd: () => string;
  /** Override for config loading — used in tests to inject a mock loader. */
  loadConfig?: typeof loadConfig;
}

const defaultDeps: ResumeDeps = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  unlinkSync: fs.unlinkSync,
  chmodSync: fs.chmodSync,
  spawnSync,
  exit: (code?: number) => process.exit(code),
  cwd: () => process.cwd(),
  loadConfig,
};

function findRalphSh(deps: ResumeDeps): string | null {
  // When installed as a package, ralph.sh is bundled at the package root.
  // __dirname will be dist/commands/, so package root is two levels up.
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

export function resumeCommand(deps: ResumeDeps = defaultDeps): void {
  const cwd = deps.cwd();
  const stateFile = path.join(cwd, 'ralph-state.json');

  // Check for saved state
  if (!deps.existsSync(stateFile)) {
    console.error(chalk.red('No interrupted run found. Nothing to resume.'));
    deps.exit(1);
  }

  // Parse the state file
  let state: RalphState;
  try {
    const raw = deps.readFileSync(stateFile, 'utf-8');
    state = JSON.parse(raw) as RalphState;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error reading ralph-state.json: ${msg}`));
    deps.exit(1);
  }

  // Validate required fields
  const requiredFields: (keyof RalphState)[] = ['version', 'prdFile', 'backend'];
  for (const field of requiredFields) {
    if (!state![field]) {
      console.error(chalk.red(`Error: ralph-state.json is missing required field: ${field}`));
      deps.exit(1);
    }
  }

  const resolvedPrd = path.resolve(cwd, state!.prdFile);

  // Check the PRD file still exists
  if (!deps.existsSync(resolvedPrd)) {
    console.error(chalk.red(`Error: PRD file not found at ${resolvedPrd}`));
    deps.exit(1);
  }

  // Load config for env vars (timeouts, etc.)
  const configLoader = deps.loadConfig ?? loadConfig;
  let config;
  try {
    config = configLoader(cwd);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${msg}`));
    deps.exit(1);
  }

  const resolvedConfig = config!;

  const ralphSh = findRalphSh(deps);
  if (!ralphSh) {
    console.error(chalk.red('Error: ralph.sh not found. Cannot resume.'));
    deps.exit(1);
  }

  // Ensure ralph.sh is executable
  try {
    deps.chmodSync(ralphSh, 0o755);
  } catch {
    // ignore chmod errors
  }

  const backend = state!.backend;
  const parallel = state!.parallel;

  console.log(chalk.bold('Resuming interrupted run...'));
  console.log(chalk.dim(`State: ${stateFile}`));
  console.log(chalk.dim(`Using PRD: ${resolvedPrd}`));
  console.log(chalk.dim(`Using backend: ${backend}`));
  console.log(chalk.dim(`Using ralph.sh: ${ralphSh}`));
  if (parallel !== undefined && parallel > 0) {
    console.log(chalk.dim(`Parallel: ${parallel} epics per wave\n`));
  } else {
    console.log(chalk.dim('Mode: sequential\n'));
  }

  const args = [resolvedPrd, '--backend', backend];
  if (parallel !== undefined && parallel > 0) {
    args.push('--parallel', String(parallel));
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

  const result = deps.spawnSync(ralphSh, args, {
    stdio: 'inherit',
    shell: false,
    env: spawnEnv,
  });

  const exitCode = result.status ?? 1;

  // Clean up state file only on success
  if (exitCode === 0) {
    try {
      deps.unlinkSync(stateFile);
      console.log(chalk.green('Resume complete. State file removed.'));
    } catch {
      // ignore unlink errors
    }
  }

  deps.exit(exitCode);
}
