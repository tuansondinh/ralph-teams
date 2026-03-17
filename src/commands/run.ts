import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { loadConfig, loadExplicitAgentModelOverrides, mergeCliOverrides } from '../config';

interface RunDeps {
  existsSync: typeof fs.existsSync;
  chmodSync: typeof fs.chmodSync;
  unlinkSync: typeof fs.unlinkSync;
  spawnSync: typeof spawnSync;
  exit: (code?: number) => never;
  cwd: () => string;
  /** Override for config loading — used in tests to inject a mock loader. */
  loadConfig?: typeof loadConfig;
  loadExplicitAgentModelOverrides?: typeof loadExplicitAgentModelOverrides;
}

const defaultDeps: RunDeps = {
  existsSync: fs.existsSync,
  chmodSync: fs.chmodSync,
  unlinkSync: fs.unlinkSync,
  spawnSync,
  exit: (code?: number) => process.exit(code),
  cwd: () => process.cwd(),
  loadConfig,
  loadExplicitAgentModelOverrides,
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

export async function runCommand(
  prdPath: string,
  options: { backend?: string; parallel?: string },
  deps: RunDeps = defaultDeps,
): Promise<void> {
  const resolved = path.resolve(prdPath);
  const stateFile = path.join(path.dirname(resolved), 'ralph-state.json');
  const parallel = options.parallel;

  if (!deps.existsSync(resolved)) {
    console.error(chalk.red(`Error: prd.json not found at ${resolved}`));
    console.error(chalk.dim('Run `ralph-teams init` to create one.'));
    deps.exit(1);
  }

  // Load ralph.config.yml (if present) and merge CLI overrides
  const configLoader = deps.loadConfig ?? loadConfig;
  let config;
  let explicitAgentOverrides;
  try {
    const baseConfig = configLoader(deps.cwd());
    const parallelNum = parallel !== undefined ? parseParallel(parallel) : undefined;
    config = mergeCliOverrides(baseConfig, {
      ...(options.backend !== undefined ? { backend: options.backend } : {}),
      ...(parallelNum !== null && parallelNum !== undefined ? { parallel: parallelNum } : {}),
    });
    const explicitOverridesLoader = deps.loadExplicitAgentModelOverrides ?? loadExplicitAgentModelOverrides;
    explicitAgentOverrides = explicitOverridesLoader(deps.cwd());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${msg}`));
    deps.exit(1);
  }

  // config is always defined here (exit called on error), but TypeScript needs this assertion
  const resolvedConfig = config!;
  const backend = resolvedConfig.execution.backend;

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
    RALPH_MODEL_TEAM_LEAD: resolvedConfig.agents.teamLead,
    RALPH_MODEL_PLANNER: resolvedConfig.agents.planner,
    RALPH_MODEL_BUILDER: resolvedConfig.agents.builder,
    RALPH_MODEL_VALIDATOR: resolvedConfig.agents.validator,
    RALPH_MODEL_MERGER: resolvedConfig.agents.merger,
    RALPH_MODEL_TEAM_LEAD_EXPLICIT: explicitAgentOverrides?.teamLead !== undefined ? '1' : '0',
    RALPH_MODEL_PLANNER_EXPLICIT: explicitAgentOverrides?.planner !== undefined ? '1' : '0',
    RALPH_MODEL_BUILDER_EXPLICIT: explicitAgentOverrides?.builder !== undefined ? '1' : '0',
    RALPH_MODEL_VALIDATOR_EXPLICIT: explicitAgentOverrides?.validator !== undefined ? '1' : '0',
    RALPH_MODEL_MERGER_EXPLICIT: explicitAgentOverrides?.merger !== undefined ? '1' : '0',
  };

  if (deps.existsSync(stateFile)) {
    try {
      deps.unlinkSync(stateFile);
      console.log(chalk.dim(`Removed stale resume state: ${stateFile}`));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: failed to remove stale ralph-state.json: ${msg}`));
      deps.exit(1);
    }
  }

  const result = deps.spawnSync(ralphSh, args, {
    stdio: 'inherit',
    shell: false,
    env: spawnEnv,
  });

  deps.exit(result.status ?? 1);
}
