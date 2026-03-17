import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, mergeCliOverrides, validateConfig, DEFAULT_CONFIG, RalphConfig } from '../src/config';

// Helper: create a temp directory and write a ralph.config.yml file there
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-config-'));
}

function writeConfig(dir: string, content: string): void {
  fs.writeFileSync(path.join(dir, 'ralph.config.yml'), content, 'utf-8');
}

// -------------------------------------------------------------------
// loadConfig — no file present
// -------------------------------------------------------------------

test('loadConfig returns defaults when ralph.config.yml is absent', () => {
  const dir = makeTempDir();
  const config = loadConfig(dir);

  assert.deepEqual(config, DEFAULT_CONFIG);
});

// -------------------------------------------------------------------
// loadConfig — valid YAML
// -------------------------------------------------------------------

test('loadConfig parses a fully-specified valid config file', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
timeouts:
  epicTimeout: 7200
  idleTimeout: 600
execution:
  validatorMaxPushbacks: 2
  parallel: 4
  backend: copilot
`);

  const config = loadConfig(dir);

  assert.equal(config.timeouts.epicTimeout, 7200);
  assert.equal(config.timeouts.idleTimeout, 600);
  assert.equal(config.execution.validatorMaxPushbacks, 2);
  assert.equal(config.execution.parallel, 4);
  assert.equal(config.execution.backend, 'copilot');
});

// -------------------------------------------------------------------
// loadConfig — partial YAML fills in defaults
// -------------------------------------------------------------------

test('loadConfig fills in defaults for fields omitted from a partial config', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
timeouts:
  epicTimeout: 1800
`);

  const config = loadConfig(dir);

  assert.equal(config.timeouts.epicTimeout, 1800);
  // All other fields should retain their defaults
  assert.equal(config.timeouts.idleTimeout, DEFAULT_CONFIG.timeouts.idleTimeout);
  assert.equal(config.execution.validatorMaxPushbacks, DEFAULT_CONFIG.execution.validatorMaxPushbacks);
  assert.equal(config.execution.parallel, DEFAULT_CONFIG.execution.parallel);
  assert.equal(config.execution.backend, DEFAULT_CONFIG.execution.backend);
});

test('loadConfig fills in defaults when only execution section is provided', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
execution:
  backend: copilot
`);

  const config = loadConfig(dir);

  assert.equal(config.execution.backend, 'copilot');
  assert.equal(config.timeouts.epicTimeout, DEFAULT_CONFIG.timeouts.epicTimeout);
  assert.equal(config.timeouts.idleTimeout, DEFAULT_CONFIG.timeouts.idleTimeout);
  assert.equal(config.execution.validatorMaxPushbacks, DEFAULT_CONFIG.execution.validatorMaxPushbacks);
  assert.equal(config.execution.parallel, DEFAULT_CONFIG.execution.parallel);
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

// -------------------------------------------------------------------
// loadConfig — invalid YAML syntax
// -------------------------------------------------------------------

test('loadConfig throws a clear error on invalid YAML syntax', () => {
  const dir = makeTempDir();
  // Deliberately malformed YAML
  writeConfig(dir, `
timeouts:
  epicTimeout: [unclosed bracket
`);

  assert.throws(() => loadConfig(dir), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /Invalid YAML in ralph\.config\.yml/i);
    return true;
  });
});

// -------------------------------------------------------------------
// loadConfig — validation errors
// -------------------------------------------------------------------

test('loadConfig throws with the invalid field identified when a field has wrong type', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
timeouts:
  epicTimeout: abc
`);

  assert.throws(() => loadConfig(dir), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /timeouts\.epicTimeout/);
    return true;
  });
});

test('loadConfig throws when backend has an unknown value', () => {
  const dir = makeTempDir();
  writeConfig(dir, `
execution:
  backend: openai
`);

  assert.throws(() => loadConfig(dir), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /execution\.backend/);
    return true;
  });
});

// -------------------------------------------------------------------
// validateConfig — descriptive errors per field
// -------------------------------------------------------------------

test('validateConfig returns errors with field paths for invalid types', () => {
  const { errors } = validateConfig({
    timeouts: { epicTimeout: 'abc', idleTimeout: -5 },
    execution: { validatorMaxPushbacks: -1, parallel: 1.5, backend: 'unknown' },
  });

  assert.ok(errors.length >= 1, 'expected at least one error');

  const joined = errors.join('\n');
  assert.match(joined, /timeouts\.epicTimeout/, 'should identify epicTimeout field');
  assert.match(joined, /timeouts\.idleTimeout/, 'should identify idleTimeout field');
  assert.match(joined, /execution\.validatorMaxPushbacks/, 'should identify validatorMaxPushbacks field');
  assert.match(joined, /execution\.parallel/, 'should identify parallel field');
  assert.match(joined, /execution\.backend/, 'should identify backend field');
});

test('validateConfig returns no errors for a valid full object', () => {
  const { errors, config } = validateConfig({
    timeouts: { epicTimeout: 1800, idleTimeout: 120 },
    execution: { validatorMaxPushbacks: 0, parallel: 2, backend: 'claude' },
  });

  assert.equal(errors.length, 0);
  assert.equal(config.timeouts.epicTimeout, 1800);
  assert.equal(config.execution.backend, 'claude');
});

test('validateConfig returns error when root value is not an object', () => {
  const { errors } = validateConfig(['not', 'an', 'object']);
  assert.ok(errors.length > 0);
});

test('validateConfig accepts 0 for parallel (unlimited)', () => {
  const { errors, config } = validateConfig({ execution: { parallel: 0 } });
  assert.equal(errors.length, 0);
  assert.equal(config.execution.parallel, 0);
});

test('validateConfig accepts 0 for validatorMaxPushbacks', () => {
  const { errors, config } = validateConfig({ execution: { validatorMaxPushbacks: 0 } });
  assert.equal(errors.length, 0);
  assert.equal(config.execution.validatorMaxPushbacks, 0);
});

// -------------------------------------------------------------------
// mergeCliOverrides
// -------------------------------------------------------------------

test('mergeCliOverrides overrides backend and parallel from CLI flags', () => {
  const base: RalphConfig = {
    timeouts: { epicTimeout: 3600, idleTimeout: 300 },
    execution: { validatorMaxPushbacks: 1, parallel: 0, backend: 'claude' },
  };

  const merged = mergeCliOverrides(base, { backend: 'copilot', parallel: 3 });

  assert.equal(merged.execution.backend, 'copilot');
  assert.equal(merged.execution.parallel, 3);
  // Timeouts should be unchanged
  assert.equal(merged.timeouts.epicTimeout, 3600);
  assert.equal(merged.timeouts.idleTimeout, 300);
  // validatorMaxPushbacks not overridden
  assert.equal(merged.execution.validatorMaxPushbacks, 1);
});

test('mergeCliOverrides with no overrides returns config unchanged', () => {
  const base: RalphConfig = {
    timeouts: { epicTimeout: 7200, idleTimeout: 600 },
    execution: { validatorMaxPushbacks: 2, parallel: 4, backend: 'copilot' },
    agents: { teamLead: 'opus', planner: 'opus', builder: 'sonnet', validator: 'sonnet', merger: 'sonnet' },
    pricing: { inputTokenCostPer1k: 0.015, outputTokenCostPer1k: 0.075, cacheReadCostPer1k: 0.0015, cacheCreationCostPer1k: 0.01875 },
  };

  const merged = mergeCliOverrides(base, {});

  assert.deepEqual(merged, base);
});

test('mergeCliOverrides with only backend override leaves parallel unchanged', () => {
  const base: RalphConfig = {
    timeouts: { epicTimeout: 3600, idleTimeout: 300 },
    execution: { validatorMaxPushbacks: 1, parallel: 5, backend: 'claude' },
  };

  const merged = mergeCliOverrides(base, { backend: 'copilot' });

  assert.equal(merged.execution.backend, 'copilot');
  assert.equal(merged.execution.parallel, 5);
});

test('mergeCliOverrides does not mutate the original config', () => {
  const base: RalphConfig = {
    timeouts: { epicTimeout: 3600, idleTimeout: 300 },
    execution: { validatorMaxPushbacks: 1, parallel: 0, backend: 'claude' },
  };

  mergeCliOverrides(base, { backend: 'copilot', parallel: 2 });

  // Original should be unchanged
  assert.equal(base.execution.backend, 'claude');
  assert.equal(base.execution.parallel, 0);
});
