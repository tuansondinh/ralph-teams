#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
  .name('ralph-claude')
  .description(chalk.bold('CLI for ralph + claude agent teams'))
  .version('0.1.0');

program.parse(process.argv);
