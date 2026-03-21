import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runRalph, setupMultiEpicRepo } = require('./helpers/ralph-shell-helpers.ts');

test('outer run writes a loop log that mirrors terminal output', () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], { 'EPIC-001': 'PASS' });
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  const loopLogs = fs.readdirSync(logsDir).filter(name => name.startsWith('loop-'));
  assert.equal(loopLogs.length, 1, `expected one loop log in ${logsDir}, found: ${loopLogs.join(', ')}`);

  const loopLogPath = path.join(logsDir, loopLogs[0]);
  const loopLog = fs.readFileSync(loopLogPath, 'utf-8');
  assert.match(result.stdout, /Outer loop log: .*\.ralph-teams\/logs\/loop-\d+\.log/);
  assert.match(loopLog, /Outer loop log: .*\.ralph-teams\/logs\/loop-\d+\.log/);
  assert.match(loopLog, /\[EPIC-001\] PASSED/);
  assert.match(loopLog, /Ralph Summary/);
});
