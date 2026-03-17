#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { statusCommand } from './commands/status';
import { initCommand } from './commands/init';
import { runCommand } from './commands/run';
import { logsCommand } from './commands/logs';
import { resetCommand } from './commands/reset';
import { validateCommand } from './commands/validate';
import { summaryCommand } from './commands/summary';
import { resumeCommand } from './commands/resume';
import { planCommand } from './commands/plan';
import { taskCommand } from './commands/task';
import packageJson from '../package.json';

const program = new Command();

program
  .name('ralph-teams')
  .description(chalk.bold('CLI for Ralph Teams'))
  .version(packageJson.version);

program
  .command('status [path]')
  .description('Show status of epics and user stories from a prd.json file')
  .action((prdPath: string = './prd.json') => {
    statusCommand(prdPath);
  });

program
  .command('init')
  .description('Interactively create a new prd.json file')
  .option('--backend <backend>', 'AI backend to use for story generation (claude, copilot, or codex)', 'claude')
  .action(async (options: { backend?: string }) => {
    await initCommand(options);
  });

program
  .command('run [path]')
  .description('Run ralph.sh with the given prd.json')
  .option('--backend <backend>', 'AI backend to use (claude, copilot, or codex)', 'claude')
  .option('--parallel <n>', 'Max epics to run in parallel per wave (default: sequential)')
  .action(async (prdPath: string = './prd.json', options: { backend?: string; parallel?: string }) => {
    await runCommand(prdPath, options);
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
  .command('validate [path]')
  .description('Validate prd.json structure and references')
  .action((prdPath: string = './prd.json') => {
    validateCommand(prdPath);
  });

program
  .command('summary [path]')
  .description('Show dependency tree and summary of all epics')
  .action((prdPath: string = './prd.json') => {
    summaryCommand(prdPath);
  });

program
  .command('plan [path]')
  .description('Discuss and create implementation plans for unplanned epics')
  .option('--backend <backend>', 'AI backend to use (claude, copilot, or codex)')
  .action(async (prdPath: string = './prd.json', options: { backend?: string }) => {
    await planCommand(prdPath, options);
  });

program
  .command('task <prompt>')
  .description('Run an ad hoc task on the current branch with the Ralph team')
  .option('--backend <backend>', 'AI backend to use (claude, copilot, or codex)')
  .action(async (prompt: string, options: { backend?: string }) => {
    await taskCommand(prompt, options);
  });

program
  .command('resume')
  .description('Resume an interrupted run from saved state')
  .option('--backend <backend>', 'Override the backend from saved state (claude | copilot | codex)')
  .action((opts: { backend?: string }) => resumeCommand(undefined, opts.backend));

program.parse(process.argv);
