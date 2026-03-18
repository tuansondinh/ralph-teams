import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, mergeCliOverrides, validateConfig, DEFAULT_CONFIG, RalphConfig, renderCommentedConfigTemplate } from '../src/config';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-config-'));
}

function writeConfig(dir: string, content: string): void {
  fs.writeFileSync(path.join(dir, 'ralph.config.yml'), content, 'utf-8');
}

function makeBaseConfig(): RalphConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as RalphConfig;
}

test('loadConfig returns defaults when ralph.config.yml is absent', () => {
  const dir = makeTempDir();
  assert.deepEqual(loadConfig(dir), DEFAULT_CONFIG);
});

test('loadConfig applies the default preset and allows explicit execution overrides', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
workflow:
  preset: default
execution:
  storyValidation:
    enabled: true
    maxFixCycles: 2
`);

  const config = loadConfig(dir);
  assert.equal(config.workflow.preset, 'default');
  assert.equal(config.execution.epicPlanning.enabled, true);
  assert.equal(config.execution.epicValidation.enabled, true);
  assert.equal(config.execution.finalValidation.enabled, true);
  assert.equal(config.execution.storyPlanning.enabled, false);
  assert.equal(config.execution.storyValidation.enabled, true);
  assert.equal(config.execution.storyValidation.maxFixCycles, 2);
});

test('loadConfig applies the thorough preset', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
workflow:
  preset: thorough
`);

  const config = loadConfig(dir);
  assert.equal(config.execution.storyPlanning.enabled, true);
  assert.equal(config.execution.storyValidation.enabled, true);
  assert.equal(config.execution.epicPlanning.enabled, true);
  assert.equal(config.execution.epicValidation.enabled, true);
  assert.equal(config.execution.finalValidation.enabled, true);
});

test('loadConfig applies the off preset', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
workflow:
  preset: off
`);

  const config = loadConfig(dir);
  assert.equal(config.execution.storyPlanning.enabled, false);
  assert.equal(config.execution.storyValidation.enabled, false);
  assert.equal(config.execution.epicPlanning.enabled, false);
  assert.equal(config.execution.epicValidation.enabled, false);
  assert.equal(config.execution.finalValidation.enabled, false);
});

test('loadConfig supports planner and validator aliases for backward compatibility', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
execution:
  validatorMaxPushbacks: 2
agents:
  planner: haiku
  validator: opus
`);

  const config = loadConfig(dir);
  assert.equal(config.execution.storyValidation.maxFixCycles, 2);
  assert.equal(config.agents.epicPlanner, 'haiku');
  assert.equal(config.agents.storyValidator, 'opus');
});

test('loadConfig returns defaults when ralph.config.yml only contains comments', () => {
  const dir = makeTempDir();
  writeConfig(dir, renderCommentedConfigTemplate());
  assert.deepEqual(loadConfig(dir), DEFAULT_CONFIG);
});

test('loadConfig throws a clear error on invalid YAML syntax', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
workflow:
  preset: [oops
`);

  assert.throws(() => loadConfig(dir), /Invalid YAML in ralph\.config\.yml/i);
});

test('validateConfig returns descriptive errors for invalid fields', () => {
  const { errors } = validateConfig({
    workflow: { preset: 'bad' },
    timeouts: { epicTimeout: 'abc', idleTimeout: -5 },
    execution: {
      parallel: 1.5,
      backend: 'unknown',
      storyPlanning: { enabled: 'yes' },
      storyValidation: { enabled: true, maxFixCycles: -1 },
      epicPlanning: { enabled: null },
      epicValidation: { enabled: false, maxFixCycles: 'x' },
      finalValidation: { enabled: 'nope', maxFixCycles: 2 },
    },
    agents: { storyPlanner: 'bad-model' },
  });

  const joined = errors.join('\n');
  assert.match(joined, /workflow\.preset/);
  assert.match(joined, /timeouts\.epicTimeout/);
  assert.match(joined, /timeouts\.idleTimeout/);
  assert.match(joined, /execution\.parallel/);
  assert.match(joined, /execution\.backend/);
  assert.match(joined, /execution\.storyPlanning\.enabled/);
  assert.match(joined, /execution\.storyValidation\.maxFixCycles/);
  assert.match(joined, /execution\.epicPlanning\.enabled/);
  assert.match(joined, /execution\.epicValidation\.maxFixCycles/);
  assert.match(joined, /execution\.finalValidation\.enabled/);
  assert.match(joined, /agents\.storyPlanner/);
});

test('validateConfig accepts a full valid object', () => {
  const { errors, config } = validateConfig({
    workflow: { preset: 'thorough' },
    timeouts: { epicTimeout: 1800, idleTimeout: 120 },
    execution: {
      parallel: 2,
      backend: 'claude',
      storyPlanning: { enabled: true },
      storyValidation: { enabled: true, maxFixCycles: 2 },
      epicPlanning: { enabled: true },
      epicValidation: { enabled: true, maxFixCycles: 1 },
      finalValidation: { enabled: true, maxFixCycles: 1 },
    },
    agents: {
      teamLead: 'opus',
      storyPlanner: 'haiku',
      epicPlanner: 'opus',
      builder: 'sonnet',
      storyValidator: 'sonnet',
      epicValidator: 'sonnet',
      finalValidator: 'sonnet',
      merger: 'sonnet',
    },
  });

  assert.equal(errors.length, 0);
  assert.equal(config.workflow.preset, 'thorough');
  assert.equal(config.execution.storyValidation.maxFixCycles, 2);
  assert.equal(config.agents.finalValidator, 'sonnet');
});

test('loadConfig accepts codex as a valid backend', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
execution:
  backend: codex
`);

  const config = loadConfig(dir);

  assert.equal(config.execution.backend, 'codex');
});

test('loadConfig accepts opencode as a valid backend', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
execution:
  backend: opencode
`);

  const config = loadConfig(dir);

  assert.equal(config.execution.backend, 'opencode');
});

test('mergeCliOverrides overrides backend and parallel without mutating the config', () => {
  const base = makeBaseConfig();
  base.execution.parallel = 5;

  const merged = mergeCliOverrides(base, { backend: 'copilot', parallel: 3 });

  assert.equal(merged.execution.backend, 'copilot');
  assert.equal(merged.execution.parallel, 3);
  assert.equal(merged.execution.finalValidation.enabled, base.execution.finalValidation.enabled);
  assert.equal(base.execution.backend, DEFAULT_CONFIG.execution.backend);
  assert.equal(base.execution.parallel, 5);
});
