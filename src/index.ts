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
import { summaryCommand } from './commands/summary';
import { resumeCommand } from './commands/resume';
import { updateStatsCommand } from './commands/update-stats';
import { statsCommand } from './commands/stats';
import { discussCommand } from './commands/discuss';
import { planCommand } from './commands/plan';

const program = new Command();

program
  .name('ralph-teams')
  .description(chalk.bold('CLI for Ralph Teams'))
  .version('0.1.2');

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
  .option('--dashboard', 'Enable TUI dashboard')
  .action(async (prdPath: string = './prd.json', options: { backend?: string; parallel?: string; dashboard?: boolean }) => {
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

program
  .command('summary [path]')
  .description('Show dependency tree and summary of all epics')
  .action((prdPath: string = './prd.json') => {
    summaryCommand(prdPath);
  });

program
  .command('discuss [path]')
  .description('Start a guided discussion for failed user stories')
  .option('--backend <backend>', 'AI backend to use (claude, copilot, or codex)')
  .action(async (prdPath: string = './prd.json', options: { backend?: string }) => {
    await discussCommand(prdPath, options);
  });

program
  .command('plan [path]')
  .description('Discuss and create implementation plans for unplanned epics')
  .option('--backend <backend>', 'AI backend to use (claude, copilot, or codex)')
  .action(async (prdPath: string = './prd.json', options: { backend?: string }) => {
    await planCommand(prdPath, options);
  });

program
  .command('resume')
  .description('Resume an interrupted run from saved state')
  .option('--backend <backend>', 'Override the backend from saved state (claude | copilot | codex)')
  .action((opts: { backend?: string }) => resumeCommand(undefined, opts.backend));

program
  .command('update-stats')
  .description('Update run stats after a story completes')
  .requiredOption('--epic-id <id>', 'Epic ID')
  .requiredOption('--story-id <id>', 'Story ID')
  .requiredOption('--log-file <path>', 'Path to the epic log file')
  .requiredOption('--passed <bool>', 'Whether the story passed (true or false)')
  .option('--backend <backend>', 'Backend used', 'claude')
  .option('--started-at <iso>', 'ISO 8601 start timestamp')
  .option('--completed-at <iso>', 'ISO 8601 completion timestamp')
  .option('--stories-total <n>', 'Total number of stories across all epics in this run')
  .action((options: {
    epicId: string;
    storyId: string;
    logFile: string;
    passed: string;
    backend: string;
    startedAt?: string;
    completedAt?: string;
    storiesTotal?: string;
  }) => {
    updateStatsCommand(options);
  });

program
  .command('stats [path]')
  .description('Show cost, token, and time stats from the current run')
  .action((statsPath: string = './ralph-run-stats.json') => {
    statsCommand(statsPath);
  });

program.parse(process.argv);
