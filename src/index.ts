#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { statusCommand } from './commands/status';
import { initCommand } from './commands/init';
import { runCommand } from './commands/run';
import { logsCommand } from './commands/logs';
import { resetCommand } from './commands/reset';
import { addEpicCommand } from './commands/add-epic';
import { validateCommand } from './commands/validate';

const program = new Command();

program
  .name('ralph-claude')
  .description(chalk.bold('CLI for ralph + claude agent teams'))
  .version('0.1.0');

program
  .command('status [path]')
  .description('Show status of epics and user stories from a prd.json file')
  .action((prdPath: string = './prd.json') => {
    statusCommand(prdPath);
  });

program
  .command('init')
  .description('Interactively create a new prd.json file')
  .action(async () => {
    await initCommand();
  });

program
  .command('run [path]')
  .description('Run ralph.sh with the given prd.json')
  .action((prdPath: string = './prd.json') => {
    runCommand(prdPath);
  });

program
  .command('logs')
  .description('View the progress log')
  .option('--tail <n>', 'Show last N entries')
  .action((options: { tail?: string }) => {
    logsCommand(options);
  });

program
  .command('reset <epicId> [path]')
  .description('Reset an epic status back to pending')
  .action((epicId: string, prdPath: string = './prd.json') => {
    resetCommand(epicId, prdPath);
  });

program
  .command('add-epic [path]')
  .description('Interactively add a new epic to prd.json')
  .action(async (prdPath: string = './prd.json') => {
    await addEpicCommand(prdPath);
  });

program
  .command('validate [path]')
  .description('Validate prd.json structure and references')
  .action((prdPath: string = './prd.json') => {
    validateCommand(prdPath);
  });

program.parse(process.argv);
