import { spawnSync } from 'child_process';
import * as path from 'path';
import chalk from 'chalk';
import { loadConfig, mergeCliOverrides } from '../config';
import { loadPrd, Prd } from '../prd-utils';
import {
  gatherDiscussContext,
  runFailedStoriesDiscussSession,
  type FailedStoryContext,
} from '../discuss';
import { getGuidancePath } from '../guidance';
import {
  getRalphGuidanceDir,
  getRalphPlansDir,
  getRalphProgressPath,
  getRalphWorktreesDir,
} from '../runtime-paths';

type SupportedBackend = 'claude' | 'copilot' | 'codex';

interface DiscussOptions {
  backend?: string;
}

interface DiscussDeps {
  cwd: () => string;
  exit: (code?: number) => never;
  loadConfig?: typeof loadConfig;
  runFailedStoriesDiscussSession?: typeof runFailedStoriesDiscussSession;
  ensureBackendAvailable?: (backend: SupportedBackend) => void;
}

const defaultDeps: DiscussDeps = {
  cwd: () => process.cwd(),
  exit: (code?: number) => process.exit(code),
  loadConfig,
  runFailedStoriesDiscussSession,
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

function collectFailedStoryContexts(prd: Prd, projectRoot: string): FailedStoryContext[] {
  const prdPath = path.join(projectRoot, 'prd.json');
  const progressPath = getRalphProgressPath(projectRoot);
  const plansDir = getRalphPlansDir(projectRoot);
  const guidanceDir = getRalphGuidanceDir(projectRoot);
  const worktreesDir = getRalphWorktreesDir(projectRoot);

  const contexts: FailedStoryContext[] = [];
  for (const epic of prd.epics) {
    const epicMayContainFailures = epic.status === 'failed' || epic.status === 'partial' || epic.status === 'merge-failed';
    for (const story of epic.userStories) {
      const reason = story.failureReason?.trim() ?? null;
      if (story.passes) {
        continue;
      }
      if (!reason && !epicMayContainFailures) {
        continue;
      }

      const base = gatherDiscussContext(
        story.id,
        prdPath,
        progressPath,
        plansDir,
        path.join(worktreesDir, epic.id),
      );

      contexts.push({
        ...base,
        storyTitle: story.title,
        epicTitle: epic.title,
        failureReason: reason,
        guidancePath: path.resolve(getGuidancePath(story.id, guidanceDir)),
      });
    }
  }

  return contexts;
}

export async function discussCommand(
  prdPath: string = './prd.json',
  options: DiscussOptions = {},
  deps: DiscussDeps = defaultDeps,
): Promise<void> {
  const { prd, resolved } = loadPrd(prdPath);
  const projectRoot = path.dirname(resolved);

  const configLoader = deps.loadConfig ?? loadConfig;
  const config = mergeCliOverrides(configLoader(projectRoot), {
    ...(options.backend !== undefined ? { backend: options.backend } : {}),
  });
  const backend = config.execution.backend as SupportedBackend;

  const failedStories = collectFailedStoryContexts(prd, projectRoot);
  if (failedStories.length === 0) {
    console.log(chalk.yellow('No failed user stories found to discuss.'));
    deps.exit(0);
  }

  const ensureBackend = deps.ensureBackendAvailable ?? ensureBackendAvailable;
  ensureBackend(backend);

  console.log(chalk.bold('\nralph-teams discuss\n'));
  console.log(chalk.dim(`Using PRD: ${resolved}`));
  console.log(chalk.dim(`Using backend: ${backend}`));
  console.log(chalk.dim(`Found ${failedStories.length} failed stor${failedStories.length === 1 ? 'y' : 'ies'}.\n`));

  const runner = deps.runFailedStoriesDiscussSession ?? runFailedStoriesDiscussSession;
  await runner(failedStories, { backend });
}

export { collectFailedStoryContexts };
