import chalk from 'chalk';
import { loadPrd, epicStatusColor } from '../prd-utils';

export function statusCommand(prdPath: string): void {
  const { prd, resolved: _resolved } = loadPrd(prdPath);

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
