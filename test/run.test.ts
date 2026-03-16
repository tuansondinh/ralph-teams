import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
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
    spawn: spawn,
    exit: (code?: number) => {
      throw new ExitSignal(code);
    },
    cwd: () => process.cwd(),
    ...overrides,
  };
}

test('runCommand exits when the PRD file is missing', async () => {
  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  await assert.rejects(runCommand('./missing-prd.json', {}, createRunDeps()), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.match(errors[0] ?? '', /prd\.json not found/i);
});

test('runCommand exits when the selected backend CLI is unavailable', async () => {
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

  await assert.rejects(runCommand(prdPath, { backend: 'claude' }, deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.ok(
    spawnCalls.some(call => call.command === 'command' && call.args?.[0] === '-v' && call.args?.[1] === 'claude'),
    'expected a claude CLI availability check',
  );
  assert.match(errors[0] ?? '', /claude CLI is not installed/i);
});

test('runCommand invokes ralph.sh with the resolved PRD path and backend', async () => {
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

  await assert.rejects(runCommand(prdPath, { backend: 'copilot', dashboard: false }, deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  const resolvedRalphSh = path.resolve('ralph.sh');
  assert.ok(
    calls.some(call => call.command === 'command' && call.args?.[0] === '-v' && call.args?.[1] === 'gh'),
    'expected a gh CLI availability check',
  );
  const ralphCall = calls.find(call => call.command === resolvedRalphSh);
  assert.ok(ralphCall, 'expected ralph.sh to be invoked');
  assert.equal(ralphCall.args?.[0], path.resolve(prdPath));
  assert.deepEqual(ralphCall.args?.slice(1), ['--backend', 'copilot']);
  assert.equal(chmodTarget, resolvedRalphSh);
  assert.ok(logs.some(line => line.includes(`Using PRD: ${path.resolve(prdPath)}`)));
  assert.ok(logs.some(line => line.includes('Using backend: copilot')));
});

test('runCommand with --parallel passes flag to ralph.sh', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));

  const tempRalphSh = path.join(tempDir, 'ralph.sh');
  fs.writeFileSync(tempRalphSh, '#!/bin/sh\n');

  const calls: Array<{ command: string; args?: readonly string[] }> = [];
  const deps = createRunDeps({
    existsSync: (target: fs.PathLike) => fs.existsSync(target),
    spawnSync: ((command: string, args?: readonly string[]) => {
      calls.push({ command, args });
      return { status: 0 } as ReturnType<NonNullable<Parameters<typeof runCommand>[2]>['spawnSync']>;
    }) as NonNullable<Parameters<typeof runCommand>[2]>['spawnSync'],
    chmodSync: (() => {}) as typeof fs.chmodSync,
    cwd: () => tempDir,
  });

  await assert.rejects(runCommand(prdPath, { backend: 'claude', parallel: '3', dashboard: false }, deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  const ralphArgs = calls.find(call => call.command === path.resolve('ralph.sh'))?.args;
  assert.ok(ralphArgs !== undefined, 'ralph.sh was not called');
  assert.ok(ralphArgs.includes('--parallel'), 'args should include --parallel');
  assert.ok(ralphArgs.includes('3'), 'args should include the parallel value');
});

test('runCommand without --parallel does not include --parallel in args', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));

  const tempRalphSh = path.join(tempDir, 'ralph.sh');
  fs.writeFileSync(tempRalphSh, '#!/bin/sh\n');

  const calls: Array<{ command: string; args?: readonly string[] }> = [];
  const deps = createRunDeps({
    existsSync: (target: fs.PathLike) => fs.existsSync(target),
    spawnSync: ((command: string, args?: readonly string[]) => {
      calls.push({ command, args });
      return { status: 0 } as ReturnType<NonNullable<Parameters<typeof runCommand>[2]>['spawnSync']>;
    }) as NonNullable<Parameters<typeof runCommand>[2]>['spawnSync'],
    chmodSync: (() => {}) as typeof fs.chmodSync,
    cwd: () => tempDir,
  });

  await assert.rejects(runCommand(prdPath, { backend: 'claude', dashboard: false }, deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  const ralphArgs = calls.find(call => call.command === path.resolve('ralph.sh'))?.args;
  assert.ok(ralphArgs !== undefined, 'ralph.sh was not called');
  assert.ok(!ralphArgs.includes('--parallel'), 'args should NOT include --parallel');
  assert.deepEqual(Array.from(ralphArgs).slice(1), ['--backend', 'claude']);
});

test('runCommand exits when --parallel is not a whole number', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));

  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  await assert.rejects(runCommand(prdPath, { backend: 'claude', parallel: 'abc' }, createRunDeps()), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.match(errors[0] ?? '', /--parallel must be a whole number/i);
});

test('runCommand exits when --parallel is zero', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));

  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  await assert.rejects(runCommand(prdPath, { backend: 'claude', parallel: '0' }, createRunDeps()), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.match(errors[0] ?? '', /--parallel must be greater than 0/i);
});

test('runCommand exits when --dashboard is requested', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));

  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  await assert.rejects(runCommand(prdPath, { backend: 'claude', dashboard: true }, createRunDeps()), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.match(errors[0] ?? '', /--dashboard is temporarily disabled/i);
});

test('runCommand without --dashboard uses spawnSync (sync path)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));

  const tempRalphSh = path.join(tempDir, 'ralph.sh');
  fs.writeFileSync(tempRalphSh, '#!/bin/sh\n');

  const spawnSyncCalls: string[] = [];
  const spawnCalls: string[] = [];

  const deps = createRunDeps({
    existsSync: (target: fs.PathLike) => fs.existsSync(target),
    spawnSync: ((command: string, args?: readonly string[]) => {
      spawnSyncCalls.push(command);
      return { status: 0 } as ReturnType<NonNullable<Parameters<typeof runCommand>[2]>['spawnSync']>;
    }) as NonNullable<Parameters<typeof runCommand>[2]>['spawnSync'],
    spawn: ((...args: Parameters<typeof spawn>) => {
      spawnCalls.push(args[0]);
      return { on: () => {} } as unknown as ReturnType<typeof spawn>;
    }) as typeof spawn,
    chmodSync: (() => {}) as typeof fs.chmodSync,
    cwd: () => tempDir,
  });

  await assert.rejects(runCommand(prdPath, { backend: 'claude', dashboard: false }, deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  // spawnSync called (for both backend check and ralph.sh invocation)
  assert.ok(spawnSyncCalls.length >= 2, 'spawnSync should be called at least twice');
  // spawn (async) should NOT be called when dashboard is disabled
  assert.equal(spawnCalls.length, 0, 'async spawn should not be called without --dashboard');
});

test('runCommand checks for the codex CLI when codex backend is selected', async () => {
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

  await assert.rejects(runCommand(prdPath, { backend: 'codex' }, deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.ok(
    spawnCalls.some(call => call.command === 'command' && call.args?.[0] === '-v' && call.args?.[1] === 'codex'),
    'expected a codex CLI availability check',
  );
  assert.match(errors[0] ?? '', /codex CLI is not installed/i);
});
