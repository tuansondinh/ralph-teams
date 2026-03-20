import { spawn, spawnSync } from 'child_process';
import * as readline from 'readline/promises';
import chalk from 'chalk';
import { loadConfig, loadExplicitAgentModelOverrides, mergeCliOverrides, type AgentModelField } from '../config';
import { createDefaultSpawner, type AgentSpawner } from '../discuss';

type SupportedBackend = 'claude' | 'copilot' | 'codex' | 'opencode';

interface TaskOptions {
  backend?: string;
}

interface TaskDeps {
  cwd: () => string;
  exit: (code?: number) => never;
  loadConfig?: typeof loadConfig;
  loadExplicitAgentModelOverrides?: typeof loadExplicitAgentModelOverrides;
  ensureBackendAvailable?: (backend: SupportedBackend) => void;
  askShouldPlan?: () => Promise<boolean>;
  runPlanningSession?: (prompt: string, backend: SupportedBackend, env: NodeJS.ProcessEnv) => Promise<void>;
  runExecutionSession?: (prompt: string, backend: SupportedBackend, env: NodeJS.ProcessEnv) => Promise<void>;
  getCurrentBranch?: () => string | null;
}

const defaultDeps: TaskDeps = {
  cwd: () => process.cwd(),
  exit: (code?: number) => process.exit(code),
  loadConfig,
  loadExplicitAgentModelOverrides,
};

const TASK_RUNTIME_AGENT_DEFAULTS: Record<AgentModelField, string> = {
  teamLead: 'opus',
  storyPlanner: 'haiku',
  epicPlanner: 'opus',
  builder: 'sonnet',
  storyValidator: 'sonnet',
  epicValidator: 'sonnet',
  finalValidator: 'sonnet',
  merger: 'sonnet',
};

function ensureBackendAvailable(backend: SupportedBackend): void {
  if (backend === 'claude') {
    const result = spawnSync('command', ['-v', 'claude'], { shell: true, stdio: 'ignore' });
    if (result.status !== 0) {
      console.error(chalk.red('Error: claude CLI is not installed or not in PATH.'));
      process.exit(1);
    }
    return;
  }

  if (backend === 'copilot') {
    const ghResult = spawnSync('command', ['-v', 'gh'], { shell: true, stdio: 'ignore' });
    if (ghResult.status !== 0) {
      console.error(chalk.red('Error: gh CLI is not installed or not in PATH.'));
      process.exit(1);
    }

    const copilotResult = spawnSync('gh', ['copilot', '--', '--version'], {
      stdio: 'ignore',
    });
    if (copilotResult.status !== 0) {
      console.error(chalk.red('Error: GitHub Copilot CLI is not available.'));
      process.exit(1);
    }
    return;
  }

  if (backend === 'codex') {
    const codexResult = spawnSync('command', ['-v', 'codex'], { shell: true, stdio: 'ignore' });
    if (codexResult.status !== 0) {
      console.error(chalk.red('Error: codex CLI is not installed or not in PATH.'));
      process.exit(1);
    }
    return;
  }

  const opencodeResult = spawnSync('command', ['-v', 'opencode'], { shell: true, stdio: 'ignore' });
  if (opencodeResult.status !== 0) {
    console.error(chalk.red('Error: opencode CLI is not installed or not in PATH.'));
    process.exit(1);
  }
}

function getCurrentBranch(): string | null {
  const result = spawnSync('git', ['branch', '--show-current'], {
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    return null;
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  return stdout === '' ? null : stdout;
}

function mapModelForBackend(backend: SupportedBackend, model: string): string {
  switch (`${backend}:${model}`) {
    case 'copilot:haiku':
      return 'gpt-5-mini';
    case 'copilot:sonnet':
      return 'gpt-5.3-codex';
    case 'copilot:opus':
      return 'gpt-5.4';
    case 'codex:haiku':
      return 'gpt-5-mini';
    case 'codex:sonnet':
      return 'gpt-5.3-codex';
    case 'codex:opus':
      return 'gpt-5.4';
    case 'opencode:haiku':
      return 'zai-coding-plan/glm-4.7-flash';
    case 'opencode:sonnet':
      return 'zai-coding-plan/glm-4.7';
    case 'opencode:opus':
      return 'zai-coding-plan/glm-5';
    default:
      return model;
  }
}

export function buildTaskPlanningPrompt(task: string, cwd: string, branch: string): string {
  return [
    'You are a senior engineering planning partner for Ralph Teams.',
    'This is an ad hoc task planning session, not a PRD/epic workflow.',
    '',
    `Task: ${task}`,
    `Repository root: ${cwd}`,
    `Current branch: ${branch}`,
    '',
    'Your job is to help the user plan the task before implementation.',
    'Start by clarifying scope, constraints, affected areas, verification strategy, and any risks.',
    'Do not implement code in this session.',
    'Do not ask the user to create files manually.',
    'Keep the discussion grounded in the current repository and branch.',
    'End with a concise implementation plan once the user signals they are ready.',
  ].join('\n');
}

export function buildTaskExecutionPrompt(task: string, cwd: string, branch: string): string {
  return [
    'You are the Team Lead for an ad hoc Ralph Teams task.',
    'This is not a PRD/epic run. Treat the task below as the whole assignment.',
    '',
    `Task: ${task}`,
    `Working directory: ${cwd}`,
    `Current branch: ${branch}`,
    '',
    'Rules:',
    '- Work in the current repository and stay on the current branch.',
    '- Do not create or switch branches unless the user explicitly asks.',
    '- You may use story-planner, builder, and story-validator teammates when helpful.',
    '- If the runtime is Claude, use Claude agent teams for delegated work instead of Claude subagents or a single-threaded solo workflow.',
    '- If the runtime supports teammate model choice, respect explicit config overrides first; otherwise choose cheaper models for easy work and stronger models for difficult work.',
    '- If the runtime is Codex, use these named teammate roles when spawning: story_planner_easy/story_planner_medium/story_planner_difficult, builder_easy/builder_medium/builder_difficult, story_validator_easy/story_validator_medium/story_validator_difficult.',
    '- You may skip planning for very simple tasks, but plan internally or via a story-planner teammate when the task has ambiguity or design risk.',
    '- When you use a planner, require it to design the automated tests that prove the task is done and pass that test design to the builder.',
    '- The builder must add or update the task-relevant automated tests and make them pass.',
    '- If you skip the planner, the builder must do TDD: define the automated tests first, make them fail, then implement until they pass.',
    '- Validate the final result appropriately before finishing.',
    '- At the end, print a concise summary of what changed and any verification performed, then exit.',
    '',
    'Execute the task now.',
  ].join('\n');
}

async function askShouldPlan(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question('Plan this task first? [y/N]: ');
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

function buildSpawnEnv(
  backend: SupportedBackend,
  projectRoot: string,
  config: ReturnType<typeof mergeCliOverrides>,
  explicitAgentOverrides: Partial<Record<AgentModelField, string>>,
): NodeJS.ProcessEnv {
  const resolveAgentModel = (field: AgentModelField): string => (
    explicitAgentOverrides[field] !== undefined
      ? config.agents[field]
      : TASK_RUNTIME_AGENT_DEFAULTS[field]
  );

  return {
    ...process.env,
    RALPH_BACKEND: backend,
    RALPH_MODEL_TEAM_LEAD: mapModelForBackend(backend, resolveAgentModel('teamLead')),
    RALPH_MODEL_STORY_PLANNER: mapModelForBackend(backend, resolveAgentModel('storyPlanner')),
    RALPH_MODEL_EPIC_PLANNER: mapModelForBackend(backend, resolveAgentModel('epicPlanner')),
    RALPH_MODEL_BUILDER: mapModelForBackend(backend, resolveAgentModel('builder')),
    RALPH_MODEL_STORY_VALIDATOR: mapModelForBackend(backend, resolveAgentModel('storyValidator')),
    RALPH_MODEL_EPIC_VALIDATOR: mapModelForBackend(backend, resolveAgentModel('epicValidator')),
    RALPH_MODEL_FINAL_VALIDATOR: mapModelForBackend(backend, resolveAgentModel('finalValidator')),
    RALPH_MODEL_MERGER: mapModelForBackend(backend, resolveAgentModel('merger')),
    RALPH_MODEL_TEAM_LEAD_EXPLICIT: explicitAgentOverrides.teamLead !== undefined ? '1' : '0',
    RALPH_MODEL_STORY_PLANNER_EXPLICIT: explicitAgentOverrides.storyPlanner !== undefined ? '1' : '0',
    RALPH_MODEL_EPIC_PLANNER_EXPLICIT: explicitAgentOverrides.epicPlanner !== undefined ? '1' : '0',
    RALPH_MODEL_BUILDER_EXPLICIT: explicitAgentOverrides.builder !== undefined ? '1' : '0',
    RALPH_MODEL_STORY_VALIDATOR_EXPLICIT: explicitAgentOverrides.storyValidator !== undefined ? '1' : '0',
    RALPH_MODEL_EPIC_VALIDATOR_EXPLICIT: explicitAgentOverrides.epicValidator !== undefined ? '1' : '0',
    RALPH_MODEL_FINAL_VALIDATOR_EXPLICIT: explicitAgentOverrides.finalValidator !== undefined ? '1' : '0',
    RALPH_MODEL_MERGER_EXPLICIT: explicitAgentOverrides.merger !== undefined ? '1' : '0',
    RALPH_TASK_PROJECT_ROOT: projectRoot,
  };
}

export function buildTaskExecutionInvocation(
  backend: SupportedBackend,
  env: NodeJS.ProcessEnv,
): { command: string; args: string[]; extraEnv?: NodeJS.ProcessEnv } {
  const cwd = env.RALPH_TASK_PROJECT_ROOT ?? process.cwd();

  if (backend === 'claude') {
    return {
      command: 'claude',
      args: [
        '--agent', 'team-lead',
        '--model', env.RALPH_MODEL_TEAM_LEAD ?? 'opus',
        '--dangerously-skip-permissions',
        '--teammate-mode', 'in-process',
      ],
      extraEnv: {
        ...env,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS ?? '1',
      },
    };
  }

  if (backend === 'copilot') {
    return {
      command: 'gh',
      args: ['copilot', '--', '--allow-all', '--no-ask-user', '-p'],
    };
  }

  if (backend === 'opencode') {
    return {
      command: 'opencode',
      args: ['.', '--prompt'],
    };
  }

  return {
    command: 'codex',
    args: [
      '-a', 'never',
      'exec',
      '-C', cwd,
      '-m', env.RALPH_MODEL_TEAM_LEAD ?? 'gpt-5.3-codex',
      '-c', 'model_reasoning_effort="high"',
      '-s', 'workspace-write',
      '--skip-git-repo-check',
      '--color', 'never',
      '--enable', 'multi_agent',
    ],
  };
}

function runSpawnedProcess(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });

    child.on('error', reject);
  });
}

async function runPlanningSession(prompt: string, backend: SupportedBackend, env: NodeJS.ProcessEnv): Promise<void> {
  const spawner: AgentSpawner = createDefaultSpawner(backend);
  const originalEnv = process.env;
  Object.assign(process.env, env);
  try {
    await spawner(prompt);
  } finally {
    process.env = originalEnv;
  }
}

async function runExecutionSession(prompt: string, backend: SupportedBackend, env: NodeJS.ProcessEnv): Promise<void> {
  const invocation = buildTaskExecutionInvocation(backend, env);
  await runSpawnedProcess(
    invocation.command,
    [...invocation.args, prompt],
    invocation.extraEnv ?? env,
  );
}

export async function taskCommand(
  task: string,
  options: TaskOptions = {},
  deps: TaskDeps = defaultDeps,
): Promise<void> {
  const cwd = deps.cwd();
  const configLoader = deps.loadConfig ?? loadConfig;
  const explicitOverridesLoader = deps.loadExplicitAgentModelOverrides ?? loadExplicitAgentModelOverrides;

  let config;
  let explicitAgentOverrides;
  try {
    config = mergeCliOverrides(configLoader(cwd), {
      ...(options.backend !== undefined ? { backend: options.backend } : {}),
    });
    explicitAgentOverrides = explicitOverridesLoader(cwd);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${msg}`));
    deps.exit(1);
  }

  const backend = config.execution.backend as SupportedBackend;
  const branchGetter = deps.getCurrentBranch ?? getCurrentBranch;
  const branch = branchGetter();
  if (!branch) {
    console.error(chalk.red('Error: ralph-teams task must be run inside a git repository on a checked out branch.'));
    deps.exit(1);
  }

  const ensureBackend = deps.ensureBackendAvailable ?? ensureBackendAvailable;
  ensureBackend(backend);

  console.log(chalk.bold('\nralph-teams task\n'));
  console.log(chalk.dim(`Task: ${task}`));
  console.log(chalk.dim(`Working directory: ${cwd}`));
  console.log(chalk.dim(`Current branch: ${branch}`));
  console.log(chalk.dim(`Using backend: ${backend}\n`));

  const shouldPlan = await (deps.askShouldPlan ?? askShouldPlan)();
  const env = buildSpawnEnv(backend, cwd, config!, explicitAgentOverrides ?? {});

  try {
    if (shouldPlan) {
      const planningPrompt = buildTaskPlanningPrompt(task, cwd, branch);
      const runner = deps.runPlanningSession ?? runPlanningSession;
      await runner(planningPrompt, backend, env);
    } else {
      const executionPrompt = buildTaskExecutionPrompt(task, cwd, branch);
      const runner = deps.runExecutionSession ?? runExecutionSession;
      await runner(executionPrompt, backend, env);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${msg}`));
    deps.exit(1);
  }
}
