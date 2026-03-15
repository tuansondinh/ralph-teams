import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { createRl, ask, askMultiline } from '../prd-utils';

interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
}

interface Epic {
  id: string;
  title: string;
  description: string;
  status: 'pending';
  dependsOn: string[];
  userStories: UserStory[];
}

interface Prd {
  project: string;
  branchName: string;
  description: string;
  epics: Epic[];
}

export async function initCommand(): Promise<void> {
  const rl = createRl();

  console.log(chalk.bold('\nralph-team-agents init\n'));

  const project = await ask(rl, chalk.cyan('Project name: '));
  const branchName = await ask(rl, chalk.cyan('Branch name: '));
  const description = await ask(rl, chalk.cyan('Project description: '));

  const epics: Epic[] = [];
  let epicIndex = 1;

  console.log(chalk.bold('\nNow let\'s add an epic.\n'));

  const epicTitle = await ask(rl, chalk.cyan('Epic title: '));
  const epicDescription = await ask(rl, chalk.cyan('Epic description: '));

  const epicId = `EPIC-${String(epicIndex).padStart(3, '0')}`;
  const userStories: UserStory[] = [];
  let storyIndex = 1;

  console.log(chalk.bold('\nAdd user stories to this epic.\n'));

  while (true) {
    const storyId = `US-${String(storyIndex).padStart(3, '0')}`;
    console.log(chalk.bold(`Story ${storyId}:`));

    const storyTitle = await ask(rl, chalk.cyan('  Title: '));
    const storyDescription = await ask(rl, chalk.cyan('  Description: '));
    const criteria = await askMultiline(rl, chalk.cyan('  Acceptance criteria'));

    userStories.push({
      id: storyId,
      title: storyTitle,
      description: storyDescription,
      acceptanceCriteria: criteria,
      priority: storyIndex,
      passes: false,
    });

    storyIndex++;

    const another = await ask(rl, chalk.cyan('\nAdd another story? (y/n): '));
    if (another.toLowerCase() !== 'y') break;
    console.log('');
  }

  epics.push({
    id: epicId,
    title: epicTitle,
    description: epicDescription,
    status: 'pending',
    dependsOn: [],
    userStories,
  });

  rl.close();

  const prd: Prd = {
    project,
    branchName,
    description,
    epics,
  };

  const outputPath = path.resolve('./prd.json');
  fs.writeFileSync(outputPath, JSON.stringify(prd, null, 2));

  console.log(chalk.green(`\nCreated ${outputPath}\n`));
}
