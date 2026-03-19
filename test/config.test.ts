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

test('loadConfig applies the balanced preset and allows explicit execution overrides', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
workflow:
  preset: balanced
execution:
  storyValidation:
    enabled: true
    maxFixCycles: 2
`);

  const config = loadConfig(dir);
  assert.equal(config.workflow.preset, 'balanced');
  assert.equal(config.execution.epicPlanning.enabled, true);
  assert.equal(config.execution.epicValidation.enabled, true);
  assert.equal(config.execution.finalValidation.enabled, false);
  assert.equal(config.execution.storyPlanning.enabled, false);
  assert.equal(config.execution.storyValidation.enabled, true);
  assert.equal(config.execution.storyValidation.maxFixCycles, 2);
});

test('loadConfig applies the full preset', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
workflow:
  preset: full
`);

  const config = loadConfig(dir);
  assert.equal(config.execution.storyPlanning.enabled, true);
  assert.equal(config.execution.storyValidation.enabled, true);
  assert.equal(config.execution.epicPlanning.enabled, true);
  assert.equal(config.execution.epicValidation.enabled, true);
  assert.equal(config.execution.finalValidation.enabled, true);
});

test('loadConfig applies the minimal preset', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
workflow:
  preset: minimal
`);

  const config = loadConfig(dir);
  assert.equal(config.execution.storyPlanning.enabled, false);
  assert.equal(config.execution.storyValidation.enabled, false);
  assert.equal(config.execution.epicPlanning.enabled, false);
  assert.equal(config.execution.epicValidation.enabled, false);
  assert.equal(config.execution.finalValidation.enabled, false);
});

test('loadConfig accepts legacy preset aliases', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
workflow:
  preset: default
`);
  const defaultAlias = loadConfig(dir);
  assert.equal(defaultAlias.workflow.preset, 'balanced');

  writeConfig(dir, `
workflow:
  preset: epic-focused
`);
  const epicFocusedAlias = loadConfig(dir);
  assert.equal(epicFocusedAlias.workflow.preset, 'balanced');

  writeConfig(dir, `
workflow:
  preset: thorough
`);
  const thoroughAlias = loadConfig(dir);
  assert.equal(thoroughAlias.workflow.preset, 'full');

  writeConfig(dir, `
workflow:
  preset: off
`);
  const offAlias = loadConfig(dir);
  assert.equal(offAlias.workflow.preset, 'minimal');
  assert.equal(offAlias.execution.storyPlanning.enabled, false);
  assert.equal(offAlias.execution.finalValidation.enabled, false);
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
    timeouts: { epicTimeout: 'abc', idleTimeout: -5, loopTimeout: -1 },
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
  assert.match(joined, /timeouts\.loopTimeout/);
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
    workflow: { preset: 'full' },
    timeouts: { epicTimeout: 1800, idleTimeout: 120, loopTimeout: 7200 },
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
      storyPlanner: 'opus',
      epicPlanner: 'opus',
      builder: 'sonnet',
      storyValidator: 'sonnet',
      epicValidator: 'opus',
      finalValidator: 'opus',
      merger: 'sonnet',
    },
  });

  assert.equal(errors.length, 0);
  assert.equal(config.workflow.preset, 'full');
  assert.equal(config.timeouts.loopTimeout, 7200);
  assert.equal(config.execution.storyValidation.maxFixCycles, 2);
  assert.equal(config.agents.finalValidator, 'opus');
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
