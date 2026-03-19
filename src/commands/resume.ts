import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { loadConfig } from '../config';
import { getRalphStatePath } from '../runtime-paths';

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

function findBundledRjq(deps: ResumeDeps): string | null {
  const candidates = [
    path.resolve(__dirname, '../../dist/json-tool.js'),
    path.resolve(__dirname, '../json-tool.js'),
    path.resolve(__dirname, '../../node_modules/.bin/rjq'),
    path.resolve(deps.cwd(), 'dist/json-tool.js'),
  ];

  for (const candidate of candidates) {
    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resumeCommand(deps: ResumeDeps = defaultDeps, backendOverride?: string): void {
  const cwd = deps.cwd();
  const stateFile = getRalphStatePath(cwd);

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
    console.error(chalk.red(`Error reading Ralph resume state: ${msg}`));
    deps.exit(1);
  }

  // Validate required fields
  const requiredFields: (keyof RalphState)[] = ['version', 'prdFile', 'backend'];
  for (const field of requiredFields) {
    if (!state![field]) {
      console.error(chalk.red(`Error: Ralph resume state is missing required field: ${field}`));
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
  const bundledRjq = findBundledRjq(deps);

  // Ensure ralph.sh is executable
  try {
    deps.chmodSync(ralphSh, 0o755);
  } catch {
    // ignore chmod errors
  }

  const backend = backendOverride ?? state!.backend;
  const parallel = state!.parallel;

  console.log(chalk.bold('Resuming interrupted run...'));
  console.log(chalk.dim(`State: ${stateFile}`));
  console.log(chalk.dim(`Using PRD: ${resolvedPrd}`));
  console.log(chalk.dim(`Using backend: ${backend}${backendOverride ? ' (overridden)' : ''}`));
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
    RALPH_RESUME: '1',
    RALPH_EPIC_TIMEOUT: String(resolvedConfig.timeouts.epicTimeout),
    RALPH_IDLE_TIMEOUT: String(resolvedConfig.timeouts.idleTimeout),
    RALPH_LOOP_TIMEOUT: String(resolvedConfig.timeouts.loopTimeout),
    RALPH_WORKFLOW_PRESET: resolvedConfig.workflow.preset,
    RALPH_STORY_PLANNING_ENABLED: resolvedConfig.execution.storyPlanning.enabled ? '1' : '0',
    RALPH_STORY_VALIDATION_ENABLED: resolvedConfig.execution.storyValidation.enabled ? '1' : '0',
    RALPH_STORY_VALIDATION_MAX_FIX_CYCLES: String(resolvedConfig.execution.storyValidation.maxFixCycles),
    RALPH_EPIC_PLANNING_ENABLED: resolvedConfig.execution.epicPlanning.enabled ? '1' : '0',
    RALPH_EPIC_VALIDATION_ENABLED: resolvedConfig.execution.epicValidation.enabled ? '1' : '0',
    RALPH_EPIC_VALIDATION_MAX_FIX_CYCLES: String(resolvedConfig.execution.epicValidation.maxFixCycles),
    RALPH_FINAL_VALIDATION_ENABLED: resolvedConfig.execution.finalValidation.enabled ? '1' : '0',
    RALPH_FINAL_VALIDATION_MAX_FIX_CYCLES: String(resolvedConfig.execution.finalValidation.maxFixCycles),
    RALPH_PARALLEL: String(resolvedConfig.execution.parallel),
    RALPH_BACKEND: resolvedConfig.execution.backend,
    RALPH_MODEL_TEAM_LEAD: resolvedConfig.agents.teamLead,
    RALPH_MODEL_STORY_PLANNER: resolvedConfig.agents.storyPlanner,
    RALPH_MODEL_EPIC_PLANNER: resolvedConfig.agents.epicPlanner,
    RALPH_MODEL_BUILDER: resolvedConfig.agents.builder,
    RALPH_MODEL_STORY_VALIDATOR: resolvedConfig.agents.storyValidator,
    RALPH_MODEL_EPIC_VALIDATOR: resolvedConfig.agents.epicValidator,
    RALPH_MODEL_FINAL_VALIDATOR: resolvedConfig.agents.finalValidator,
    RALPH_MODEL_MERGER: resolvedConfig.agents.merger,
    ...(bundledRjq ? { RALPH_RJQ_BIN: bundledRjq } : {}),
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
