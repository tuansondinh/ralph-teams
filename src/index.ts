#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { statusCommand } from './commands/status';

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

program.parse(process.argv);
