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

test('resumeCommand forwards RALPH_MODEL_* env vars to ralph.sh', () => {
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
    loadConfig: () => ({
      timeouts: { epicTimeout: 3600, idleTimeout: 600 },
      execution: { validatorMaxPushbacks: 1, parallel: 0, backend: 'claude' },
      agents: { teamLead: 'opus', planner: 'haiku', builder: 'opus', validator: 'sonnet', merger: 'sonnet' },
      pricing: { inputTokenCostPer1k: 0.015, outputTokenCostPer1k: 0.075, cacheReadCostPer1k: 0.0015, cacheCreationCostPer1k: 0.01875 },
    }),
    loadExplicitAgentModelOverrides: () => ({ planner: 'haiku' }),
  });

  assert.throws(() => resumeCommand(deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  const ralphCall = calls.find(c => c.command.endsWith('ralph.sh'));
  assert.ok(ralphCall, 'ralph.sh was not called');
  const env = ralphCall!.env!;

  // Agent model values from config
  assert.equal(env['RALPH_MODEL_TEAM_LEAD'], 'opus');
  assert.equal(env['RALPH_MODEL_PLANNER'], 'haiku');
  assert.equal(env['RALPH_MODEL_BUILDER'], 'opus');
  assert.equal(env['RALPH_MODEL_VALIDATOR'], 'sonnet');
  assert.equal(env['RALPH_MODEL_MERGER'], 'sonnet');

  // Explicit flags: only planner was in explicitAgentOverrides
  assert.equal(env['RALPH_MODEL_TEAM_LEAD_EXPLICIT'], '0');
  assert.equal(env['RALPH_MODEL_PLANNER_EXPLICIT'], '1');
  assert.equal(env['RALPH_MODEL_BUILDER_EXPLICIT'], '0');
  assert.equal(env['RALPH_MODEL_VALIDATOR_EXPLICIT'], '0');
  assert.equal(env['RALPH_MODEL_MERGER_EXPLICIT'], '0');
});

test('resumeCommand sets RALPH_MODEL_*_EXPLICIT=0 when no config file', () => {
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
    loadConfig: () => ({
      timeouts: { epicTimeout: 3600, idleTimeout: 600 },
      execution: { validatorMaxPushbacks: 1, parallel: 0, backend: 'claude' },
      agents: { teamLead: 'opus', planner: 'opus', builder: 'sonnet', validator: 'sonnet', merger: 'sonnet' },
      pricing: { inputTokenCostPer1k: 0.015, outputTokenCostPer1k: 0.075, cacheReadCostPer1k: 0.0015, cacheCreationCostPer1k: 0.01875 },
    }),
    loadExplicitAgentModelOverrides: () => ({}),
  });

  assert.throws(() => resumeCommand(deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  const ralphCall = calls.find(c => c.command.endsWith('ralph.sh'));
  assert.ok(ralphCall, 'ralph.sh was not called');
  const env = ralphCall!.env!;

  // All EXPLICIT flags should be '0' when no config file (empty overrides)
  assert.equal(env['RALPH_MODEL_TEAM_LEAD_EXPLICIT'], '0');
  assert.equal(env['RALPH_MODEL_PLANNER_EXPLICIT'], '0');
  assert.equal(env['RALPH_MODEL_BUILDER_EXPLICIT'], '0');
  assert.equal(env['RALPH_MODEL_VALIDATOR_EXPLICIT'], '0');
  assert.equal(env['RALPH_MODEL_MERGER_EXPLICIT'], '0');
});

test('resumeCommand loads config from PRD directory, not cwd', () => {
  // prdDir contains the prd.json, ralph.config.yml with a recognizable epicTimeout, and state
  const prdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-resume-prddir-'));
  const prdPath = path.join(prdDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({ epics: [] }));
  // Write config with a distinctive epicTimeout in prdDir
  fs.writeFileSync(path.join(prdDir, 'ralph.config.yml'), 'timeouts:\n  epicTimeout: 9999\n');
  // Write ralph.sh into prdDir so findRalphSh can locate it
  const tempRalphSh = path.join(prdDir, 'ralph.sh');
  fs.writeFileSync(tempRalphSh, '#!/bin/sh\n');

  // Write state file in a different directory (the cwd)
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-resume-other-'));
  const stateFile = path.join(otherDir, '.ralph-teams', 'ralph-state.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  // State references prdPath in prdDir (absolute path so resolve works from otherDir)
  fs.writeFileSync(stateFile, makeState({ prdFile: prdPath }));

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
    // cwd points to a directory without any ralph.config.yml (state is there, but no config)
    cwd: () => otherDir,
  });

  assert.throws(() => resumeCommand(deps), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  const ralphCall = calls.find(c => c.command.endsWith('ralph.sh'));
  assert.ok(ralphCall, 'ralph.sh was not called');
  // Config must have been loaded from prdDir, so RALPH_EPIC_TIMEOUT should be '9999'
  assert.equal(ralphCall!.env?.['RALPH_EPIC_TIMEOUT'], '9999', 'expected RALPH_EPIC_TIMEOUT from PRD directory config');
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
