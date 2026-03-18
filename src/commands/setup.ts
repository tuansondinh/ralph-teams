import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline/promises';
import chalk from 'chalk';
import { DEFAULT_CONFIG, RalphConfig, renderConfigYaml } from '../config';

export interface SetupOptions {
  backend?: string;
  ifMissingOnly?: boolean;
}

export interface SetupDeps {
  cwd: () => string;
  pathExists: (target: string) => boolean;
  readFile: (target: string) => string;
  writeFile: (target: string, content: string) => void;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  exit: (code?: number) => never;
  ask: (question: string) => Promise<string>;
}

function createAsk(): SetupDeps['ask'] {
  return async (question: string) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  };
}

const defaultDeps: SetupDeps = {
  cwd: () => process.cwd(),
  pathExists: (target: string) => fs.existsSync(target),
  readFile: (target: string) => fs.readFileSync(target, 'utf-8'),
  writeFile: (target: string, content: string) => fs.writeFileSync(target, content, 'utf-8'),
  log: (...args: unknown[]) => console.log(...args),
  error: (...args: unknown[]) => console.error(...args),
  exit: (code?: number) => process.exit(code),
  ask: createAsk(),
};

function cloneConfig(config: RalphConfig): RalphConfig {
  return JSON.parse(JSON.stringify(config)) as RalphConfig;
}

function normalizeChoice(value: string): string {
  return value.trim().toLowerCase();
}

function isYes(value: string, defaultYes = false): boolean {
  const normalized = normalizeChoice(value);
  if (normalized === '') {
    return defaultYes;
  }
  return normalized === 'y' || normalized === 'yes';
}

async function askWithDefault(deps: SetupDeps, label: string, defaultValue: string): Promise<string> {
  const answer = await deps.ask(`${label} [${defaultValue}]: `);
  const trimmed = answer.trim();
  return trimmed === '' ? defaultValue : trimmed;
}

async function askChoice(
  deps: SetupDeps,
  label: string,
  options: string[],
  defaultValue: string,
): Promise<string> {
  while (true) {
    const answer = normalizeChoice(await askWithDefault(deps, `${label} (${options.join('/')})`, defaultValue));
    if (options.includes(answer)) {
      return answer;
    }
    deps.error(chalk.red(`Invalid choice: ${answer}. Expected one of: ${options.join(', ')}`));
  }
}

async function askNonNegativeInteger(
  deps: SetupDeps,
  label: string,
  defaultValue: number,
): Promise<number> {
  while (true) {
    const answer = await askWithDefault(deps, label, String(defaultValue));
    if (/^\d+$/.test(answer.trim())) {
      return parseInt(answer.trim(), 10);
    }
    deps.error(chalk.red(`Invalid number: ${answer}. Expected a non-negative whole number.`));
  }
}

async function maybeOverwriteExistingConfig(
  configPath: string,
  options: SetupOptions,
  deps: SetupDeps,
): Promise<boolean> {
  if (!deps.pathExists(configPath)) {
    return true;
  }

  if (options.ifMissingOnly === true) {
    return false;
  }

  deps.log(chalk.dim(`Existing config found at ${configPath}.`));
  const overwrite = await deps.ask('Overwrite it? [y/N]: ');
  if (!isYes(overwrite, false)) {
    deps.log(chalk.dim('Keeping existing ralph.config.yml.'));
    return false;
  }

  return true;
}

async function promptForAgentModels(
  deps: SetupDeps,
  config: RalphConfig,
): Promise<void> {
  const useDefaults = await deps.ask('Use default agent models? [Y/n]: ');
  if (isYes(useDefaults, true)) {
    return;
  }

  const roleOrder: Array<keyof RalphConfig['agents']> = [
    'teamLead',
    'storyPlanner',
    'epicPlanner',
    'builder',
    'storyValidator',
    'epicValidator',
    'finalValidator',
    'merger',
  ];

  for (const role of roleOrder) {
    const answer = await askChoice(
      deps,
      `${role} model`,
      ['haiku', 'sonnet', 'opus'],
      config.agents[role],
    );
    config.agents[role] = answer;
  }
}

export async function setupCommand(
  options: SetupOptions = {},
  deps: SetupDeps = defaultDeps,
): Promise<{ configPath: string; created: boolean }> {
  const projectRoot = deps.cwd();
  const configPath = path.join(projectRoot, 'ralph.config.yml');

  if (!(await maybeOverwriteExistingConfig(configPath, options, deps))) {
    return { configPath, created: false };
  }

  const config = cloneConfig(DEFAULT_CONFIG);

  deps.log(chalk.bold('\nralph-teams setup\n'));
  deps.log(chalk.dim('Configure Ralph Teams for this repository.\n'));

  config.execution.backend = await askChoice(
    deps,
    'Default backend',
    ['claude', 'copilot', 'codex', 'opencode'],
    options.backend ?? config.execution.backend,
  );

  config.workflow.preset = await askChoice(
    deps,
    'Workflow preset',
    ['default', 'thorough', 'off'],
    config.workflow.preset,
  ) as RalphConfig['workflow']['preset'];

  if (config.workflow.preset === 'default') {
    config.execution.storyPlanning.enabled = false;
    config.execution.storyValidation.enabled = false;
    config.execution.storyValidation.maxFixCycles = 1;
    config.execution.epicPlanning.enabled = true;
    config.execution.epicValidation.enabled = true;
    config.execution.epicValidation.maxFixCycles = 1;
    config.execution.finalValidation.enabled = true;
    config.execution.finalValidation.maxFixCycles = 1;
  } else if (config.workflow.preset === 'thorough') {
    config.execution.storyPlanning.enabled = true;
    config.execution.storyValidation.enabled = true;
    config.execution.storyValidation.maxFixCycles = 1;
    config.execution.epicPlanning.enabled = true;
    config.execution.epicValidation.enabled = true;
    config.execution.epicValidation.maxFixCycles = 1;
    config.execution.finalValidation.enabled = true;
    config.execution.finalValidation.maxFixCycles = 1;
  } else {
    config.execution.storyPlanning.enabled = false;
    config.execution.storyValidation.enabled = false;
    config.execution.storyValidation.maxFixCycles = 1;
    config.execution.epicPlanning.enabled = false;
    config.execution.epicValidation.enabled = false;
    config.execution.epicValidation.maxFixCycles = 1;
    config.execution.finalValidation.enabled = false;
    config.execution.finalValidation.maxFixCycles = 1;
  }

  config.execution.parallel = await askNonNegativeInteger(
    deps,
    'Max epics to run in parallel (0 = unlimited)',
    config.execution.parallel,
  );

  await promptForAgentModels(deps, config);

  deps.writeFile(configPath, renderConfigYaml(config));
  deps.log(chalk.green(`\nWrote ${configPath}\n`));
  return { configPath, created: true };
}
