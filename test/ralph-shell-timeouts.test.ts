import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  BASH,
  readLoopBranchPrd,
  runRalphWithSigint,
  scriptPath,
  setupIdleTimeoutRepo,
  setupMultiEpicRepo,
} from './helpers/ralph-shell-helpers.js';

test('US-008: SIGINT writes ralph-state.json with expected fields', { timeout: 10000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  await runRalphWithSigint(tempDir, env);
  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  assert.ok(fs.existsSync(stateFile));
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
  assert.equal(state['version'], 1);
  assert.ok(typeof state['prdFile'] === 'string');
  assert.ok(typeof state['currentWave'] === 'number');
  assert.ok(Array.isArray(state['activeEpics']));
  assert.ok(typeof state['backend'] === 'string');
  assert.ok(typeof state['timestamp'] === 'string');
});

test('US-008: SIGINT prints resume message', { timeout: 10000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  const { stdout } = await runRalphWithSigint(tempDir, env);
  assert.match(stdout, /Run interrupted\. Resume with: ralph-teams resume/);
});

test('US-008: SIGINT exits with code 130', { timeout: 10000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  const { code } = await runRalphWithSigint(tempDir, env);
  assert.equal(code, 130);
});

test('US-008: the shared loop worktree is preserved after SIGINT', { timeout: 10000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  await runRalphWithSigint(tempDir, env);
  const worktreesDir = path.join(tempDir, '.ralph-teams', '.worktrees');
  const loopDirs = fs.existsSync(worktreesDir)
    ? fs.readdirSync(worktreesDir).filter((entry) => entry.startsWith('loop-'))
    : [];
  assert.equal(loopDirs.length, 1);
  assert.ok(!fs.existsSync(path.join(tempDir, '.ralph-teams', '.worktrees', 'EPIC-001')));
});

test('US-008: ralph-state.json includes the active epic ID', { timeout: 10000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  await runRalphWithSigint(tempDir, env);
  const state = JSON.parse(fs.readFileSync(path.join(tempDir, '.ralph-teams', 'ralph-state.json'), 'utf-8')) as Record<string, unknown>;
  const activeEpics = state['activeEpics'] as string[];
  assert.ok(activeEpics.includes('EPIC-001'));
});

test('US-008: ralph-state.json includes storyProgress field', { timeout: 10000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  await runRalphWithSigint(tempDir, env);
  const state = JSON.parse(fs.readFileSync(path.join(tempDir, '.ralph-teams', 'ralph-state.json'), 'utf-8')) as Record<string, unknown>;
  assert.ok('storyProgress' in state);
  const storyProgress = state['storyProgress'] as Record<string, unknown>;
  assert.ok('EPIC-001' in storyProgress);
  const epicStories = storyProgress['EPIC-001'] as Record<string, unknown>;
  assert.ok('US-001' in epicStories);
});

test('US-008: ralph-state.json includes interruptedStoryId field', { timeout: 10000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  await runRalphWithSigint(tempDir, env);
  const state = JSON.parse(fs.readFileSync(path.join(tempDir, '.ralph-teams', 'ralph-state.json'), 'utf-8')) as Record<string, unknown>;
  assert.ok('interruptedStoryId' in state);
});

test('US-004 (timeout): epic is killed and marked failed after RALPH_EPIC_TIMEOUT seconds', { timeout: 10000 }, () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_EPIC_TIMEOUT'] = '1';
  const start = Date.now();
  const result = spawnSync(BASH, [scriptPath, 'prd.json'], { cwd: tempDir, encoding: 'utf-8', env, timeout: 12000 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 10000);
  const prd = readLoopBranchPrd(tempDir) as { epics: Array<{ status: string }> };
  assert.equal(prd.epics[0].status, 'failed');
  assert.match(result.stdout, /\[EPIC-001\] TIMED OUT after 1s/);
});

test('US-004 (timeout): timeout event is logged to progress.txt', { timeout: 10000 }, () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_EPIC_TIMEOUT'] = '1';
  spawnSync(BASH, [scriptPath, 'prd.json'], { cwd: tempDir, encoding: 'utf-8', env, timeout: 12000 });
  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] FAILED \(epic timeout after 1s\)/);
});

test('US-004 (timeout): timed-out epic log file contains timeout message', { timeout: 10000 }, () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_EPIC_TIMEOUT'] = '1';
  spawnSync(BASH, [scriptPath, 'prd.json'], { cwd: tempDir, encoding: 'utf-8', env, timeout: 12000 });
  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  const logFiles = fs.readdirSync(logsDir).filter((f) => f.includes('EPIC-001'));
  assert.ok(logFiles.length > 0);
  const logContent = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf-8');
  assert.match(logContent, /TIMEOUT: Epic exceeded 1s limit/);
});

test('US-004 (timeout): with two independent epics, one times out and the other completes', { timeout: 15000 }, () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }, { id: 'EPIC-002', title: 'Beta' }],
    { 'EPIC-002': 'PASS' },
  );
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_EPIC_TIMEOUT'] = '1';
  const result = spawnSync(BASH, [scriptPath, 'prd.json', '--parallel', '2'], { cwd: tempDir, encoding: 'utf-8', env, timeout: 12000 });
  const prd = readLoopBranchPrd(tempDir) as { epics: Array<{ status: string }> };
  const epic1Status = prd.epics.find((e: { id: string }) => e.id === 'EPIC-001').status;
  const epic2Status = prd.epics.find((e: { id: string }) => e.id === 'EPIC-002').status;
  assert.equal(epic1Status, 'failed');
  assert.equal(epic2Status, 'completed', `stdout: ${result.stdout}`);
});

test('US-005 (idle timeout): idle epic is killed and marked failed after RALPH_IDLE_TIMEOUT seconds', { timeout: 10000 }, () => {
  const { tempDir, env } = setupIdleTimeoutRepo([{ id: 'EPIC-001', title: 'Alpha' }]);
  env['MOCK_SILENT_EPIC_001'] = '1';
  env['RALPH_IDLE_TIMEOUT'] = '1';
  const start = Date.now();
  const result = spawnSync(BASH, [scriptPath, 'prd.json'], { cwd: tempDir, encoding: 'utf-8', env, timeout: 12000 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 10000);
  const prd = readLoopBranchPrd(tempDir) as { epics: Array<{ status: string }> };
  assert.equal(prd.epics[0].status, 'failed');
  assert.match(result.stdout, /\[EPIC-001\] IDLE TIMEOUT — no output for 1s/);
});

test('US-005 (idle timeout): GNU stat -f output does not break log mtime parsing', { timeout: 10000 }, () => {
  const { tempDir, binDir, env } = setupIdleTimeoutRepo([{ id: 'EPIC-001', title: 'Alpha' }]);
  env['MOCK_SILENT_EPIC_001'] = '1';
  env['RALPH_IDLE_TIMEOUT'] = '1';
  const mockStat = [
    '#!/bin/sh',
    'if [ "$1" = "-f" ] && [ "$2" = "%m" ]; then',
    '  echo "File: \\"$3\\""',
    '  echo "ID: deadbeef Namelen: 255 Type: ext2/ext3"',
    '  exit 0',
    'fi',
    'exec /usr/bin/stat "$@"',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'stat'), mockStat);
  fs.chmodSync(path.join(binDir, 'stat'), 0o755);
  const result = spawnSync(BASH, [scriptPath, 'prd.json'], { cwd: tempDir, encoding: 'utf-8', env, timeout: 12000 });
  assert.notEqual(result.status, null);
  assert.doesNotMatch(result.stderr, /integer expression expected|unbound variable/);
  const prd = readLoopBranchPrd(tempDir) as { epics: Array<{ status: string }> };
  assert.equal(prd.epics[0].status, 'failed');
});

test('US-005 (idle timeout): idle timeout event is logged to progress.txt', { timeout: 10000 }, () => {
  const { tempDir, env } = setupIdleTimeoutRepo([{ id: 'EPIC-001', title: 'Alpha' }]);
  env['MOCK_SILENT_EPIC_001'] = '1';
  env['RALPH_IDLE_TIMEOUT'] = '1';
  spawnSync(BASH, [scriptPath, 'prd.json'], { cwd: tempDir, encoding: 'utf-8', env, timeout: 12000 });
  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] FAILED \(idle timeout — no output for 1s\)/);
});

test('US-005 (idle timeout): with two epics, only idle one is killed while active one completes', { timeout: 15000 }, () => {
  const { tempDir, env } = setupIdleTimeoutRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }, { id: 'EPIC-002', title: 'Beta' }],
    { 'EPIC-002': 'PASS' },
  );
  env['MOCK_SILENT_EPIC_001'] = '1';
  env['RALPH_IDLE_TIMEOUT'] = '1';
  const result = spawnSync(BASH, [scriptPath, 'prd.json', '--parallel', '2'], { cwd: tempDir, encoding: 'utf-8', env, timeout: 12000 });
  const prd = readLoopBranchPrd(tempDir) as { epics: Array<{ status: string }> };
  const epic1Status = prd.epics.find((e: { id: string }) => e.id === 'EPIC-001').status;
  const epic2Status = prd.epics.find((e: { id: string }) => e.id === 'EPIC-002').status;
  assert.equal(epic1Status, 'failed');
  assert.equal(epic2Status, 'completed', `stdout: ${result.stdout}`);
});

test('US-009 (loop timeout): whole run stops after RALPH_LOOP_TIMEOUT seconds and saves resume state', { timeout: 10000 }, () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_LOOP_TIMEOUT'] = '1';
  const result = spawnSync(BASH, [scriptPath, 'prd.json'], { cwd: tempDir, encoding: 'utf-8', env, timeout: 12000 });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Overall loop timeout reached after 1s/);
  assert.ok(fs.existsSync(path.join(tempDir, '.ralph-teams', 'ralph-state.json')));

  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[loop\] FAILED \(overall loop timeout after 1s\)/);
});
