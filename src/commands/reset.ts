import chalk from 'chalk';
import { loadPrd, savePrd } from '../prd-utils';

export function resetCommand(epicId: string, prdPath: string): void {
  const { prd, resolved } = loadPrd(prdPath);

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
