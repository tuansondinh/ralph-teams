import chalk from 'chalk';
import { loadPrd, savePrd, createRl, ask, askMultiline, UserStory, Epic } from '../prd-utils';

export async function addEpicCommand(prdPath: string): Promise<void> {
  const { prd, resolved } = loadPrd(prdPath);
  const rl = createRl();

  // Auto-generate next epic ID
  let maxEpicNum = 0;
  for (const epic of prd.epics) {
    const match = epic.id.match(/^EPIC-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxEpicNum) maxEpicNum = num;
    }
  }
  const epicId = `EPIC-${String(maxEpicNum + 1).padStart(3, '0')}`;

  // Auto-generate next story ID (scan ALL epics globally)
  let maxStoryNum = 0;
  for (const epic of prd.epics) {
    for (const story of epic.userStories) {
      const match = story.id.match(/^US-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxStoryNum) maxStoryNum = num;
      }
    }
  }

  console.log(chalk.bold(`\nAdding epic ${epicId}\n`));

  const epicTitle = await ask(rl, chalk.cyan('Epic title: '));
  const epicDescription = await ask(rl, chalk.cyan('Epic description: '));

  // Show existing epics for dependency selection
  let dependsOn: string[] = [];
  if (prd.epics.length > 0) {
    const validEpicIds = new Set(prd.epics.map((epic) => epic.id));
    console.log(chalk.dim('\nExisting epics:'));
    for (const e of prd.epics) {
      console.log(chalk.dim(`  ${e.id}: ${e.title}`));
    }

    while (true) {
      const depsInput = await ask(rl, chalk.cyan('\nDependencies (comma-separated epic IDs, or Enter for none): '));
      if (depsInput.trim() === '') {
        break;
      }

      const candidateDeps = depsInput.split(',').map(d => d.trim()).filter(d => d !== '');
      const unknownDeps = candidateDeps.filter((dep) => !validEpicIds.has(dep));
      if (unknownDeps.length === 0) {
        dependsOn = candidateDeps;
        break;
      }

      console.log(chalk.red(`Unknown epic IDs: ${unknownDeps.join(', ')}`));
    }
  }

  // Collect user stories
  const userStories: UserStory[] = [];
  let storyIndex = maxStoryNum + 1;

  console.log(chalk.bold('\nAdd user stories to this epic.\n'));
  console.log(chalk.dim('Target about 5 user stories for an epic when the scope supports it.\n'));

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
      priority: userStories.length + 1,
      passes: false,
    });

    storyIndex++;

    const another = await ask(rl, chalk.cyan('\nAdd another story? (y/n): '));
    if (another.toLowerCase() !== 'y') break;
    console.log('');
  }

  const newEpic: Epic = {
    id: epicId,
    title: epicTitle,
    description: epicDescription,
    status: 'pending',
    dependsOn,
    userStories,
  };

  prd.epics.push(newEpic);
  savePrd(resolved, prd);

  rl.close();

  console.log(chalk.green(`\nAdded ${epicId}: ${epicTitle}`));
  console.log(chalk.dim(`  ${userStories.length} stories added`));
  console.log(chalk.dim(`  Saved to ${resolved}\n`));
}
