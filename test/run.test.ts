import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCommand } from '../src/commands/run';
import { ExitSignal, mockProcessExit } from './helpers';

afterEach(() => {
  mock.restoreAll();
});

function createRunDeps(overrides: Partial<Parameters<typeof runCommand>[2]> = {}) {
  return {
    existsSync: fs.existsSync,
    chmodSync: fs.chmodSync,
    spawnSync: () => ({ status: 0 }) as ReturnType<NonNullable<Parameters<typeof runCommand>[2]>['spawnSync']>,
    exit: (code?: number) => {
      throw new ExitSignal(code);
    },
    cwd: () => process.cwd(),
    ...overrides,
  };
}

test('runCommand exits when the PRD file is missing', () => {
  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  assert.throws(() => runCommand('./missing-prd.json', {}, createRunDeps()), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.match(errors[0] ?? '', /prd\.json not found/i);
});

test('runCommand exits when the selected backend CLI is unavailable', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));

  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });
  const spawnCalls: Array<{ command: string; args?: readonly string[] }> = [];
  const deps = createRunDeps({
    spawnSync: ((command: string, args?: readonly string[]) => {
      spawnCalls.push({ command, args });
      return { status: 1 } as ReturnType<NonNullable<Parameters<typeof runCommand>[2]>['spawnSync']>;
    }) as NonNullable<Parameters<typeof runCommand>[2]>['spawnSync'],
  });

  assert.throws(() => runCommand(prdPath, { backend: 'claude' }, deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.deepEqual(spawnCalls, [{ command: 'command', args: ['-v', 'claude'] }]);
  assert.match(errors[0] ?? '', /claude CLI is not installed/i);
});

test('runCommand invokes ralph.sh with the resolved PRD path and backend', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));

  const logs: string[] = [];
  mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  const calls: Array<{ command: string; args?: readonly string[] }> = [];
  let chmodTarget: string | undefined;
  const tempRalphSh = path.join(tempDir, 'ralph.sh');
  fs.writeFileSync(tempRalphSh, '#!/bin/sh\n');
  const deps = createRunDeps({
    existsSync: (target: fs.PathLike) => fs.existsSync(target),
    spawnSync: ((command: string, args?: readonly string[]) => {
      calls.push({ command, args });
      return { status: 0 } as ReturnType<NonNullable<Parameters<typeof runCommand>[2]>['spawnSync']>;
    }) as NonNullable<Parameters<typeof runCommand>[2]>['spawnSync'],
    chmodSync: ((target: fs.PathLike) => {
      chmodTarget = String(target);
    }) as typeof fs.chmodSync,
    cwd: () => tempDir,
  });

  assert.throws(() => runCommand(prdPath, { backend: 'copilot' }, deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  const resolvedRalphSh = path.resolve('ralph.sh');
  assert.deepEqual(calls[0], { command: 'command', args: ['-v', 'gh'] });
  assert.equal(calls[1]?.args?.[0], path.resolve(prdPath));
  assert.deepEqual(calls[1]?.args?.slice(1), ['--backend', 'copilot']);
  assert.equal(calls[1]?.command, resolvedRalphSh);
  assert.equal(chmodTarget, resolvedRalphSh);
  assert.ok(logs.some(line => line.includes(`Using PRD: ${path.resolve(prdPath)}`)));
  assert.ok(logs.some(line => line.includes('Using backend: copilot')));
});
