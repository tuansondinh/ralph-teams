import chalk from 'chalk';
import { loadPrd, epicStatusColor } from '../prd-utils';

export function summaryCommand(prdPath: string): void {
  const { prd } = loadPrd(prdPath);

  // Build status map for blocked checking
  const statusMap = new Map<string, string>();
  for (const epic of prd.epics) {
    statusMap.set(epic.id, epic.status);
  }

  // Print project header
  if (prd.project) {
    console.log(chalk.bold(`\nProject: ${prd.project}`));
  }

  // Print dependency arrows section
  console.log(chalk.bold('\nDependencies:'));
  let hasDeps = false;
  for (const epic of prd.epics) {
    for (const dep of epic.dependsOn ?? []) {
      console.log(chalk.dim(`  ${dep} → ${epic.id}`));
      hasDeps = true;
    }
  }
  if (!hasDeps) {
    console.log(chalk.dim('  (no dependencies)'));
  }

  // Print epic list with details
  console.log(chalk.bold('\nEpics:'));
  for (const epic of prd.epics) {
    const total = epic.userStories.length;
    const passed = epic.userStories.filter(s => s.passes).length;

    // Determine if blocked
    const deps = epic.dependsOn ?? [];
    const isBlocked = deps.some(dep => statusMap.get(dep) !== 'completed');

    // Pass rate color
    let passRateStr: string;
    if (total === 0) {
      passRateStr = chalk.dim('0/0 passed');
    } else if (passed === total) {
      passRateStr = chalk.green(`${passed}/${total} passed`);
    } else if (passed === 0) {
      passRateStr = chalk.red(`${passed}/${total} passed`);
    } else {
      passRateStr = chalk.yellow(`${passed}/${total} passed`);
    }

    // Dependency annotation
    const depAnnotation = deps.length > 0
      ? chalk.dim(` ← ${deps.join(', ')}`)
      : '';

    // Blocked label
    const blockedLabel = isBlocked ? `  ${chalk.red.bold('⚠ BLOCKED')}` : '';

    const statusStr = epicStatusColor(epic.status);
    const epicLabel = `${chalk.bold(epic.id)}: ${epic.title}${depAnnotation}`;
    const statusPadded = `[${statusStr}]`;

    console.log(`  ${epicLabel}  ${statusPadded}  ${passRateStr}${blockedLabel}`);
  }

  console.log('');
}
