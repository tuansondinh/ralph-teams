import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface UserStory {
  id: string;
  title: string;
  passes: boolean;
}

interface Epic {
  id: string;
  title: string;
  status: 'pending' | 'completed' | 'partial' | 'failed';
  userStories: UserStory[];
}

interface Prd {
  project?: string;
  epics: Epic[];
}

function epicStatusColor(status: string): string {
  switch (status) {
    case 'completed': return chalk.green(status);
    case 'failed':    return chalk.red(status);
    case 'partial':   return chalk.yellow(status);
    default:          return chalk.yellow(status);
  }
}

export function statusCommand(prdPath: string): void {
  const resolved = path.resolve(prdPath);

  if (!fs.existsSync(resolved)) {
    console.error(chalk.red(`Error: prd.json not found at ${resolved}`));
    process.exit(1);
  }

  let prd: Prd;
  try {
    prd = JSON.parse(fs.readFileSync(resolved, 'utf-8')) as Prd;
  } catch {
    console.error(chalk.red(`Error: failed to parse ${resolved}`));
    process.exit(1);
  }

  if (prd.project) {
    console.log(chalk.bold(`\nProject: ${prd.project}`));
  }

  let totalStories = 0;
  let passedStories = 0;
  let completedEpics = 0;

  for (const epic of prd.epics) {
    console.log(`\n  ${chalk.bold(epic.id)}: ${epic.title} [${epicStatusColor(epic.status)}]`);

    for (const story of epic.userStories) {
      totalStories++;
      if (story.passes) {
        passedStories++;
        console.log(`    ${chalk.green('✓')} ${story.id}: ${story.title}`);
      } else {
        console.log(`    ${chalk.red('✗')} ${story.id}: ${story.title}`);
      }
    }

    if (epic.status === 'completed') completedEpics++;
  }

  console.log(`\n${chalk.bold('Summary:')} ${passedStories}/${totalStories} stories passed, ${completedEpics}/${prd.epics.length} epics completed\n`);
}
