import chalk from 'chalk';
import { loadPrd, savePrd } from '../prd-utils';

export function resetCommand(epicId: string | undefined, prdPath: string): void {
  const { prd, resolved } = loadPrd(prdPath);

  if (!epicId) {
    for (const epic of prd.epics) {
      epic.status = 'pending';
      for (const story of epic.userStories) {
        story.passes = false;
      }
    }

    savePrd(resolved, prd);

    const storyCount = prd.epics.reduce((total, epic) => total + epic.userStories.length, 0);
    console.log(chalk.green('Reset all epics'));
    console.log(chalk.dim(`  ${prd.epics.length} epics reset to pending`));
    console.log(chalk.dim(`  ${storyCount} stories reset to not passed`));
    return;
  }

  const epic = prd.epics.find(e => e.id === epicId);
  if (!epic) {
    console.error(chalk.red(`Error: epic "${epicId}" not found`));
    process.exit(1);
  }

  epic.status = 'pending';
  for (const story of epic.userStories) {
    story.passes = false;
  }

  savePrd(resolved, prd);

  console.log(chalk.green(`Reset ${epicId}: ${epic.title}`));
  console.log(chalk.dim(`  Status → pending`));
  console.log(chalk.dim(`  ${epic.userStories.length} stories reset to not passed`));
}
