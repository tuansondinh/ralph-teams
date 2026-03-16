import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateCommand } from '../src/commands/validate';
import { ExitSignal, mockProcessExit } from './helpers';

afterEach(() => {
  mock.restoreAll();
});

function writeTempPrd(contents: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-validate-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, contents);
  return prdPath;
}

test('validateCommand accepts a valid PRD', () => {
  const prdPath = writeTempPrd(JSON.stringify({
    project: 'Demo',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Auth',
        status: 'pending',
        userStories: [
          { id: 'US-001', title: 'Sign in', passes: false },
        ],
      },
    ],
  }));

  const exit = mockProcessExit();
  const logs: string[] = [];
  mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  assert.throws(() => validateCommand(prdPath), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  assert.equal(exit.mock.callCount(), 1);
  assert.match(logs[0] ?? '', /prd\.json is valid/i);
});

test('validateCommand accepts merge-failed as a valid epic status', () => {
  const prdPath = writeTempPrd(JSON.stringify({
    project: 'Demo',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Auth',
        status: 'merge-failed',
        userStories: [
          { id: 'US-001', title: 'Sign in', passes: false },
        ],
      },
    ],
  }));

  const exit = mockProcessExit();

  assert.throws(() => validateCommand(prdPath), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 0);
    return true;
  });

  assert.equal(exit.mock.callCount(), 1);
});

test('validateCommand reports duplicate IDs, unknown dependencies, and cycles', () => {
  const prdPath = writeTempPrd(JSON.stringify({
    epics: [
      {
        id: 'EPIC-001',
        title: 'One',
        status: 'pending',
        dependsOn: ['EPIC-002', 'EPIC-999'],
        userStories: [{ id: 'US-001', title: 'Story A', passes: false }],
      },
      {
        id: 'EPIC-002',
        title: 'Two',
        status: 'pending',
        dependsOn: ['EPIC-001'],
        userStories: [{ id: 'US-001', title: 'Story B', passes: true }],
      },
      {
        id: 'EPIC-003',
        title: 'Invalid',
        status: 'invalid',
        userStories: [{ id: 'US-001', title: 'Story C', passes: false }],
      },
      {
        id: 'EPIC-003',
        title: 'Duplicate',
        status: 'pending',
        userStories: [],
      },
    ],
  }));

  const exit = mockProcessExit();
  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  assert.throws(() => validateCommand(prdPath), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.equal(exit.mock.callCount(), 1);
  const combined = errors.join('\n');
  assert.match(combined, /Duplicate epic ID: EPIC-003/);
  assert.match(combined, /Duplicate story ID: US-001/);
  assert.match(combined, /dependsOn unknown epic ID: EPIC-999/);
  assert.match(combined, /Circular dependency detected involving:/);
  assert.match(combined, /invalid status "invalid"/);
  assert.match(combined, /Missing required field: project/);
  assert.match(combined, /userStories must be a non-empty array/);
});

test('validateCommand rejects empty epics and invalid dependsOn entries', () => {
  const prdPath = writeTempPrd(JSON.stringify({
    project: 'Demo',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Auth',
        status: 'pending',
        dependsOn: [42],
        userStories: [
          { id: 'US-001', title: 'Sign in', passes: false },
        ],
      },
    ],
  }));

  const exit = mockProcessExit();
  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  assert.throws(() => validateCommand(prdPath), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.equal(exit.mock.callCount(), 1);
  assert.match(errors.join('\n'), /dependsOn\[0\] must be a string/);
});

test('validateCommand rejects an empty epic list', () => {
  const prdPath = writeTempPrd(JSON.stringify({
    project: 'Demo',
    epics: [],
  }));

  const exit = mockProcessExit();
  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  assert.throws(() => validateCommand(prdPath), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.equal(exit.mock.callCount(), 1);
  assert.match(errors.join('\n'), /epics \(must be a non-empty array\)/);
});

test('validateCommand exits on malformed JSON', () => {
  const prdPath = writeTempPrd('{not-json');

  const exit = mockProcessExit();
  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  assert.throws(() => validateCommand(prdPath), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.equal(exit.mock.callCount(), 1);
  assert.match(errors[0] ?? '', /failed to parse/i);
});
