#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { statusCommand } from './commands/status';
import { initCommand } from './commands/init';
import { runCommand } from './commands/run';

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

program.parse(process.argv);
