import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadConfig, mergeCliOverrides } from '../config';
import { createDefaultSpawner, type AgentSpawner } from '../discuss';
import { loadPrd, type Epic } from '../prd-utils';
import { getRalphPlansDir } from '../runtime-paths';

type SupportedBackend = 'claude' | 'copilot' | 'codex';

interface PlanOptions {
  backend?: string;
}

interface PlanDeps {
  exit: (code?: number) => never;
  loadConfig?: typeof loadConfig;
  spawnAgent?: AgentSpawner;
  ensureBackendAvailable?: (backend: SupportedBackend) => void;
}

export interface UnplannedEpicContext {
  id: string;
  title: string;
  description?: string;
  dependsOn: string[];
  planned: boolean;
  userStories: Array<{
    id: string;
    title: string;
    description?: string;
    acceptanceCriteria?: string[];
    priority?: number;
  }>;
  planPath: string;
}

const defaultDeps: PlanDeps = {
  exit: (code?: number) => process.exit(code),
  loadConfig,
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

  const codexResult = spawnSync('command', ['-v', 'codex'], { shell: true, stdio: 'ignore' });
  if (codexResult.status !== 0) {
    console.error(chalk.red('Error: codex CLI is not installed or not in PATH.'));
    process.exit(1);
  }
}

export function collectUnplannedEpics(epics: Epic[], plansDir: string): UnplannedEpicContext[] {
  return epics
    .filter(epic => epic.planned !== true)
    .map(epic => ({
      id: epic.id,
      title: epic.title,
      description: epic.description,
      dependsOn: epic.dependsOn ?? [],
      planned: epic.planned === true,
      userStories: epic.userStories.map(story => ({
        id: story.id,
        title: story.title,
        description: story.description,
        acceptanceCriteria: story.acceptanceCriteria,
        priority: story.priority,
      })),
      planPath: path.resolve(path.join(plansDir, `plan-${epic.id}.md`)),
    }));
}

export function buildPlanPrompt(
  prdPath: string,
  contexts: UnplannedEpicContext[],
  plansDir: string,
): string {
  const sep = '─'.repeat(72);
  const epicBlocks = contexts.map(context => [
    sep,
    `${context.id} — ${context.title}`,
    `Depends on: ${context.dependsOn.length > 0 ? context.dependsOn.join(', ') : '(none)'}`,
    `Write plan to: ${context.planPath}`,
    '',
    JSON.stringify({
      id: context.id,
      title: context.title,
      description: context.description,
      dependsOn: context.dependsOn,
      userStories: context.userStories,
    }, null, 2),
  ].join('\n'));

  return [
    'You are the implementation planning agent for Ralph Teams.',
    'Your job is to discuss implementation plans with the user for the unplanned epics in the PRD.',
    '',
    `PRD path: ${prdPath}`,
    `Plans directory: ${path.resolve(plansDir)}`,
    '',
    'Start by asking the user whether they want to plan all unplanned epics now or only a subset.',
    'Then work epic by epic.',
    '',
    'For each epic you plan:',
    '- discuss the implementation approach with the user before writing the plan',
    '- identify architecture, sequencing, risks, dependencies, verification strategy, and any open technical decisions',
    '- write the final plan to the exact plan path listed for that epic',
    '- update the epic in the PRD to set planned=true once the user agrees the plan is ready',
    '',
    'If the user chooses to skip an epic for now:',
    '- do not write a plan file for that epic',
    '- leave planned=false in the PRD',
    '',
    'Rules:',
    '- Do not implement code in this session',
    '- Do not ask the user to create files manually',
    '- The plan files should be actionable for the Team Lead and builders',
    '- A planned epic must not require the Team Lead to spawn another planner later',
    '- End by summarizing which epics were planned and which were skipped',
    '',
    ...epicBlocks,
    sep,
  ].join('\n');
}

export async function planCommand(
  prdPath: string = './prd.json',
  options: PlanOptions = {},
  deps: PlanDeps = defaultDeps,
): Promise<void> {
  const { prd, resolved } = loadPrd(prdPath);
  const projectRoot = path.dirname(resolved);
  const plansDir = getRalphPlansDir(projectRoot);

  const configLoader = deps.loadConfig ?? loadConfig;
  const config = mergeCliOverrides(configLoader(projectRoot), {
    ...(options.backend !== undefined ? { backend: options.backend } : {}),
  });
  const backend = config.execution.backend as SupportedBackend;

  const unplannedEpics = collectUnplannedEpics(prd.epics, plansDir);
  if (unplannedEpics.length === 0) {
    console.log(chalk.yellow('All epics are already marked as planned.'));
    deps.exit(0);
  }

  const ensureBackend = deps.ensureBackendAvailable ?? ensureBackendAvailable;
  ensureBackend(backend);

  fs.mkdirSync(plansDir, { recursive: true });

  console.log(chalk.bold('\nralph-teams plan\n'));
  console.log(chalk.dim(`Using PRD: ${resolved}`));
  console.log(chalk.dim(`Using backend: ${backend}`));
  console.log(chalk.dim(`Found ${unplannedEpics.length} unplanned epic${unplannedEpics.length === 1 ? '' : 's'}.\n`));

  const prompt = buildPlanPrompt(resolved, unplannedEpics, plansDir);
  const spawner = deps.spawnAgent ?? createDefaultSpawner(backend);

  try {
    await spawner(prompt);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${msg}`));
    deps.exit(1);
  }
}
