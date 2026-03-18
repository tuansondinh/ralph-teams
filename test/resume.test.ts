import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resumeCommand, ResumeDeps } from '../src/commands/resume';
import { ExitSignal } from './helpers';

afterEach(() => {
  mock.restoreAll();
});

/** Minimal valid ralph-state.json content. */
function makeState(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '1',
    prdFile: './prd.json',
    backend: 'claude',
    ...overrides,
  });
}

function createResumeDeps(overrides: Partial<ResumeDeps> = {}): ResumeDeps {
  return {
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    unlinkSync: fs.unlinkSync,
    chmodSync: fs.chmodSync,
    spawnSync: (() => ({ status: 0 })) as unknown as ResumeDeps['spawnSync'],
    exit: (code?: number) => {
      throw new ExitSignal(code);
    },
    cwd: () => process.cwd(),
    ...overrides,
  };
}

test('resumeCommand prints error and exits 1 when no ralph-state.json exists', () => {
  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-resume-'));
  const deps = createResumeDeps({ cwd: () => tempDir });

  assert.throws(() => resumeCommand(deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.ok(
    errors.some(e => /No interrupted run found/i.test(e)),
    `Expected "No interrupted run found" in errors, got: ${JSON.stringify(errors)}`,
  );
});

test('resumeCommand with valid state invokes ralph.sh with correct PRD path and backend', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-resume-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));
  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, makeState({ prdFile: prdPath }));

  const tempRalphSh = path.join(tempDir, 'ralph.sh');
  fs.writeFileSync(tempRalphSh, '#!/bin/sh\n');

  const calls: Array<{ command: string; args?: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
  const deps = createResumeDeps({
    existsSync: (p: fs.PathLike) => fs.existsSync(p),
    readFileSync: (p: fs.PathOrFileDescriptor, opts?: BufferEncoding | (fs.ObjectEncodingOptions & { flag?: string }) | null) =>
      fs.readFileSync(p, opts as BufferEncoding),
    spawnSync: ((command: string, args?: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ command, args, env: options?.env });
      return { status: 0 } as ReturnType<ResumeDeps['spawnSync']>;
    }) as ResumeDeps['spawnSync'],
    unlinkSync: fs.unlinkSync,
    chmodSync: (() => {}) as typeof fs.chmodSync,
    cwd: () => tempDir,
  });

  assert.throws(() => resumeCommand(deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  // The last spawnSync call (after possible chmod) should be ralph.sh
  const ralphCall = calls.find(c => c.command.endsWith('ralph.sh'));
  assert.ok(ralphCall, 'ralph.sh was not called');
  assert.ok(ralphCall!.args?.includes(prdPath), 'args should include the PRD path');
  assert.ok(ralphCall!.args?.includes('--backend'), 'args should include --backend');
  assert.ok(ralphCall!.args?.includes('claude'), 'args should include the backend value');
  assert.equal(ralphCall!.env?.RALPH_RESUME, '1');
});

test('resumeCommand passes configured timeout env vars to ralph.sh', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-resume-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));
  fs.writeFileSync(path.join(tempDir, 'ralph.config.yml'), [
    'timeouts:',
    '  epicTimeout: 44',
    '  idleTimeout: 55',
    '  loopTimeout: 66',
    '',
  ].join('\n'));
  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, makeState({ prdFile: prdPath }));

  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const deps = createResumeDeps({
    existsSync: (p: fs.PathLike) => fs.existsSync(p),
    readFileSync: (p: fs.PathOrFileDescriptor, opts?: BufferEncoding | (fs.ObjectEncodingOptions & { flag?: string }) | null) =>
      fs.readFileSync(p, opts as BufferEncoding),
    spawnSync: ((command: string, args?: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => {
      if (command.endsWith('ralph.sh')) {
        capturedEnv = options?.env;
      }
      return { status: 0 } as ReturnType<ResumeDeps['spawnSync']>;
    }) as ResumeDeps['spawnSync'],
    unlinkSync: fs.unlinkSync,
    chmodSync: (() => {}) as typeof fs.chmodSync,
    cwd: () => tempDir,
  });

  assert.throws(() => resumeCommand(deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  assert.equal(capturedEnv?.RALPH_EPIC_TIMEOUT, '44');
  assert.equal(capturedEnv?.RALPH_IDLE_TIMEOUT, '55');
  assert.equal(capturedEnv?.RALPH_LOOP_TIMEOUT, '66');
});

test('resumeCommand deletes ralph-state.json after successful run', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-resume-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));
  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, makeState({ prdFile: prdPath }));

  const tempRalphSh = path.join(tempDir, 'ralph.sh');
  fs.writeFileSync(tempRalphSh, '#!/bin/sh\n');

  let unlinkedPath: string | undefined;
  const deps = createResumeDeps({
    existsSync: (p: fs.PathLike) => fs.existsSync(p),
    readFileSync: (p: fs.PathOrFileDescriptor, opts?: BufferEncoding | (fs.ObjectEncodingOptions & { flag?: string }) | null) =>
      fs.readFileSync(p, opts as BufferEncoding),
    spawnSync: (() => ({ status: 0 })) as unknown as ResumeDeps['spawnSync'],
    unlinkSync: ((p: fs.PathLike) => { unlinkedPath = String(p); }) as typeof fs.unlinkSync,
    chmodSync: (() => {}) as typeof fs.chmodSync,
    cwd: () => tempDir,
  });

  assert.throws(() => resumeCommand(deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  assert.equal(unlinkedPath, stateFile, 'ralph-state.json should be deleted on success');
});

test('resumeCommand preserves ralph-state.json after failed run', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-resume-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));
  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, makeState({ prdFile: prdPath }));

  const tempRalphSh = path.join(tempDir, 'ralph.sh');
  fs.writeFileSync(tempRalphSh, '#!/bin/sh\n');

  let unlinkedPath: string | undefined;
  const deps = createResumeDeps({
    existsSync: (p: fs.PathLike) => fs.existsSync(p),
    readFileSync: (p: fs.PathOrFileDescriptor, opts?: BufferEncoding | (fs.ObjectEncodingOptions & { flag?: string }) | null) =>
      fs.readFileSync(p, opts as BufferEncoding),
    spawnSync: (() => ({ status: 1 })) as unknown as ResumeDeps['spawnSync'],
    unlinkSync: ((p: fs.PathLike) => { unlinkedPath = String(p); }) as typeof fs.unlinkSync,
    chmodSync: (() => {}) as typeof fs.chmodSync,
    cwd: () => tempDir,
  });

  assert.throws(() => resumeCommand(deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.equal(unlinkedPath, undefined, 'ralph-state.json should NOT be deleted on failure');
});

test('resumeCommand validates required fields in state file', () => {
  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-resume-'));
  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  // Missing 'backend' field
  fs.writeFileSync(stateFile, JSON.stringify({ version: '1', prdFile: './prd.json' }));

  const deps = createResumeDeps({
    existsSync: (p: fs.PathLike) => fs.existsSync(p),
    readFileSync: (p: fs.PathOrFileDescriptor, opts?: BufferEncoding | (fs.ObjectEncodingOptions & { flag?: string }) | null) =>
      fs.readFileSync(p, opts as BufferEncoding),
    cwd: () => tempDir,
  });

  assert.throws(() => resumeCommand(deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.ok(
    errors.some(e => /missing required field.*backend/i.test(e)),
    `Expected missing field error for 'backend', got: ${JSON.stringify(errors)}`,
  );
});

test('resumeCommand passes --parallel to ralph.sh when present in state', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-resume-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));
  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, makeState({ prdFile: prdPath, parallel: 3 }));

  const tempRalphSh = path.join(tempDir, 'ralph.sh');
  fs.writeFileSync(tempRalphSh, '#!/bin/sh\n');

  const calls: Array<{ command: string; args?: readonly string[] }> = [];
  const deps = createResumeDeps({
    existsSync: (p: fs.PathLike) => fs.existsSync(p),
    readFileSync: (p: fs.PathOrFileDescriptor, opts?: BufferEncoding | (fs.ObjectEncodingOptions & { flag?: string }) | null) =>
      fs.readFileSync(p, opts as BufferEncoding),
    spawnSync: ((command: string, args?: readonly string[]) => {
      calls.push({ command, args });
      return { status: 0 } as ReturnType<ResumeDeps['spawnSync']>;
    }) as ResumeDeps['spawnSync'],
    unlinkSync: fs.unlinkSync,
    chmodSync: (() => {}) as typeof fs.chmodSync,
    cwd: () => tempDir,
  });

  assert.throws(() => resumeCommand(deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  const ralphCall = calls.find(c => c.command.endsWith('ralph.sh'));
  assert.ok(ralphCall, 'ralph.sh was not called');
  assert.ok(ralphCall!.args?.includes('--parallel'), 'args should include --parallel');
  assert.ok(ralphCall!.args?.includes('3'), 'args should include the parallel value');
});
