import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildInitPrompt } from '../src/commands/init';
import { DEFAULT_CONFIG, loadConfig } from '../src/config';
import { setupCommand } from '../src/commands/setup';

const SAMPLE_EXAMPLE = '{"project": "example", "epics": []}';
const SAMPLE_OUTPUT = '/tmp/prd.json';

function getPrompt(): string {
  return buildInitPrompt(SAMPLE_EXAMPLE, SAMPLE_OUTPUT);
}

test('buildInitPrompt includes "Design Questions" phase gate', () => {
  assert.ok(getPrompt().includes('Design Questions'), 'prompt must include "Design Questions"');
});

test('buildInitPrompt includes "Epic Ordering" section', () => {
  assert.ok(getPrompt().includes('Epic Ordering'), 'prompt must include "Epic Ordering"');
});

test('buildInitPrompt includes dependency graph language', () => {
  assert.ok(getPrompt().includes('dependency graph'), 'prompt must include "dependency graph"');
});

test('buildInitPrompt includes dependsOn instruction', () => {
  assert.ok(getPrompt().includes('dependsOn'), 'prompt must include "dependsOn"');
});

test('buildInitPrompt includes consolidate instruction', () => {
  assert.ok(getPrompt().includes('consolidat'), 'prompt must include "consolidat" (covers consolidate/consolidation)');
});

test('buildInitPrompt includes the output path in the rules', () => {
  const prompt = buildInitPrompt(SAMPLE_EXAMPLE, '/custom/path/prd.json');
  assert.ok(prompt.includes('/custom/path/prd.json'), 'prompt must contain the output path');
});

test('buildInitPrompt includes the prd example schema reference', () => {
  assert.ok(getPrompt().includes(SAMPLE_EXAMPLE), 'prompt must include the prd example content');
});

test('buildInitPrompt requires user confirmation before proceeding past Phase 2', () => {
  assert.ok(
    getPrompt().includes('Do NOT proceed until the user confirms'),
    'prompt must gate Phase 3 on user dependency confirmation',
  );
});

test('buildInitPrompt includes bad/good story consolidation examples', () => {
  const prompt = getPrompt();
  assert.ok(prompt.includes('Bad example'), 'prompt must include a bad story example');
  assert.ok(prompt.includes('Good example'), 'prompt must include a good story example');
});

test('buildInitPrompt enforces dependsOn on every epic including parallel ones', () => {
  const prompt = getPrompt();
  assert.ok(
    prompt.includes('dependsOn MUST be set for every epic'),
    'prompt must mandate dependsOn on every epic',
  );
  assert.ok(
    prompt.includes('can run in parallel'),
    'prompt must address parallel epics and their dependsOn handling',
  );
});

test('buildInitPrompt asks whether to move into planning or skip', () => {
  const prompt = getPrompt();
  assert.ok(prompt.includes('plan the implementation now or skip for later'));
  assert.ok(prompt.includes('continue in the same session'));
  assert.ok(prompt.includes('Planning must be collaborative'));
  assert.ok(prompt.includes('ask follow-up questions whenever scope, architecture, sequencing, ownership, or verification is ambiguous'));
  assert.ok(prompt.includes('Resolve ambiguity through discussion first'));
  assert.ok(prompt.includes('write .ralph-teams/plans/plan-EPIC-xxx.md'));
  assert.ok(prompt.includes('planned=true'));
  assert.ok(prompt.includes('Do NOT tell the user to run `ralph-teams plan`'));
  assert.ok(prompt.includes('Do NOT ask for permission to "kick off" planning as a separate command'));
});

test('setupCommand writes a configured ralph.config.yml from interactive answers', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-setup-'));
  const answers = [
    'codex',
    'thorough',
    '3',
    'n',
    'opus',
    'haiku',
    'sonnet',
    'sonnet',
    'haiku',
    'sonnet',
    'opus',
    'haiku',
  ];
  const logs: string[] = [];

  const result = await setupCommand({}, {
    cwd: () => projectRoot,
    pathExists: (target) => fs.existsSync(target),
    readFile: (target) => fs.readFileSync(target, 'utf-8'),
    writeFile: (target, content) => fs.writeFileSync(target, content, 'utf-8'),
    log: (...args) => { logs.push(args.join(' ')); },
    error: (...args) => { throw new Error(args.join(' ')); },
    exit: ((code?: number) => { throw new Error(`exit:${code}`); }) as never,
    ask: async () => answers.shift() ?? '',
  });

  assert.equal(result.created, true);
  const config = loadConfig(projectRoot);
  assert.equal(config.execution.backend, 'codex');
  assert.equal(config.workflow.preset, 'thorough');
  assert.equal(config.execution.parallel, 3);
  assert.equal(config.execution.storyPlanning.enabled, true);
  assert.equal(config.execution.finalValidation.enabled, true);
  assert.equal(config.agents.teamLead, 'opus');
  assert.equal(config.agents.storyPlanner, 'haiku');
  assert.equal(config.agents.finalValidator, 'opus');
  assert.ok(logs.some(line => line.includes('Wrote')));
});

test('setupCommand keeps the existing config when init uses ifMissingOnly', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-setup-'));
  const configPath = path.join(projectRoot, 'ralph.config.yml');
  fs.writeFileSync(configPath, 'execution:\n  backend: codex\n', 'utf-8');

  const result = await setupCommand({ ifMissingOnly: true }, {
    cwd: () => projectRoot,
    pathExists: (target) => fs.existsSync(target),
    readFile: (target) => fs.readFileSync(target, 'utf-8'),
    writeFile: (target, content) => fs.writeFileSync(target, content, 'utf-8'),
    log: () => {},
    error: (...args) => { throw new Error(args.join(' ')); },
    exit: ((code?: number) => { throw new Error(`exit:${code}`); }) as never,
    ask: async () => {
      throw new Error('should not prompt when ifMissingOnly is true and config exists');
    },
  });

  assert.equal(result.created, false);
  assert.equal(loadConfig(projectRoot).execution.backend, 'codex');
});

test('setupCommand uses defaults when the user accepts them', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-setup-'));
  const answers = ['', '', '', ''];

  await setupCommand({}, {
    cwd: () => projectRoot,
    pathExists: (target) => fs.existsSync(target),
    readFile: (target) => fs.readFileSync(target, 'utf-8'),
    writeFile: (target, content) => fs.writeFileSync(target, content, 'utf-8'),
    log: () => {},
    error: (...args) => { throw new Error(args.join(' ')); },
    exit: ((code?: number) => { throw new Error(`exit:${code}`); }) as never,
    ask: async () => answers.shift() ?? '',
  });

  assert.deepEqual(loadConfig(projectRoot), DEFAULT_CONFIG);
});
