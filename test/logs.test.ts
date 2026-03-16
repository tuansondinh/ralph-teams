import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logsCommand } from '../src/commands/logs';
import { ExitSignal, mockProcessExit } from './helpers';

afterEach(() => {
  mock.restoreAll();
});

test('logsCommand prints only the requested tail entries', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-logs-'));
  const previousCwd = process.cwd();
  process.chdir(tempDir);

  try {
    fs.writeFileSync(
      path.join(tempDir, 'progress.txt'),
      ['## EPIC-001', 'PASS story one', '', '---', '## EPIC-002', 'FAIL story two'].join('\n'),
    );

    const lines: string[] = [];
    mock.method(console, 'log', (...args: unknown[]) => {
      lines.push(args.join(' '));
    });

    logsCommand({ tail: '1' });

    const output = lines.join('\n');
    assert.doesNotMatch(output, /EPIC-001/);
    assert.match(output, /EPIC-002/);
    assert.match(output, /FAIL story two/);
  } finally {
    process.chdir(previousCwd);
  }
});

test('logsCommand exits on an invalid tail value', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-logs-'));
  const previousCwd = process.cwd();
  process.chdir(tempDir);

  try {
    fs.writeFileSync(path.join(tempDir, 'progress.txt'), 'PASS item');

    const exit = mockProcessExit();
    const errors: string[] = [];
    mock.method(console, 'error', (...args: unknown[]) => {
      errors.push(args.join(' '));
    });

    assert.throws(() => logsCommand({ tail: '0' }), (error: unknown) => {
      assert.ok(error instanceof ExitSignal);
      assert.equal(error.code, 1);
      return true;
    });

    assert.equal(exit.mock.callCount(), 1);
    assert.match(errors[0] ?? '', /--tail must be a positive integer/i);
  } finally {
    process.chdir(previousCwd);
  }
});

test('logsCommand tails the last wave block from a real progress log', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-logs-'));
  const previousCwd = process.cwd();
  process.chdir(tempDir);

  try {
    fs.writeFileSync(
      path.join(tempDir, 'progress.txt'),
      [
        '# Ralph Progress Log',
        'Started: date',
        'PRD: prd.json',
        '---',
        '',
        '=== Wave 1 — date ===',
        '  EPIC-001',
        '[EPIC-001] PASSED — date',
        '',
        '=== Wave 2 — date ===',
        '  EPIC-002',
        '[EPIC-002] FAILED — date — FAIL: 0/1 stories passed',
      ].join('\n'),
    );

    const lines: string[] = [];
    mock.method(console, 'log', (...args: unknown[]) => {
      lines.push(args.join(' '));
    });

    logsCommand({ tail: '1' });

    const output = lines.join('\n');
    assert.doesNotMatch(output, /Wave 1/);
    assert.match(output, /Wave 2/);
    assert.match(output, /EPIC-002/);
  } finally {
    process.chdir(previousCwd);
  }
});
