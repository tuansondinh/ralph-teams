import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resetCommand } from '../src/commands/reset';
import { ExitSignal, mockProcessExit } from './helpers';

afterEach(() => {
  mock.restoreAll();
});

function writeTempPrd(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-reset-'));
  const prdPath = path.join(tempDir, 'prd.json');
  fs.writeFileSync(prdPath, JSON.stringify({
    epics: [
      {
        id: 'EPIC-001',
        title: 'Payments',
        status: 'failed',
        userStories: [
          { id: 'US-001', title: 'Checkout', passes: true },
          { id: 'US-002', title: 'Refunds', passes: true },
        ],
      },
      {
        id: 'EPIC-002',
        title: 'Notifications',
        status: 'completed',
        userStories: [
          { id: 'US-003', title: 'Emails', passes: true },
        ],
      },
    ],
  }, null, 2));
  return prdPath;
}

test('resetCommand returns an epic to pending and clears story passes', () => {
  const prdPath = writeTempPrd();
  const logs: string[] = [];
  mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  resetCommand('EPIC-001', prdPath);

  const updated = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  assert.equal(updated.epics[0].status, 'pending');
  assert.deepEqual(updated.epics[0].userStories.map((story: { passes: boolean }) => story.passes), [false, false]);
  assert.match(logs.join('\n'), /Reset EPIC-001: Payments/);
});

test('resetCommand without an epic ID resets all epics and stories', () => {
  const prdPath = writeTempPrd();
  const logs: string[] = [];
  mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  resetCommand(undefined, prdPath);

  const updated = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  assert.deepEqual(updated.epics.map((epic: { status: string }) => epic.status), ['pending', 'pending']);
  assert.deepEqual(
    updated.epics.flatMap((epic: { userStories: Array<{ passes: boolean }> }) => epic.userStories.map((story) => story.passes)),
    [false, false, false],
  );
  assert.match(logs.join('\n'), /Reset all epics/);
  assert.match(logs.join('\n'), /2 epics reset to pending/);
  assert.match(logs.join('\n'), /3 stories reset to not passed/);
});

test('resetCommand exits when the epic does not exist', () => {
  const prdPath = writeTempPrd();

  const exit = mockProcessExit();
  const errors: string[] = [];
  mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  assert.throws(() => resetCommand('EPIC-999', prdPath), (error: unknown) => {
    assert.ok(error instanceof ExitSignal);
    assert.equal(error.code, 1);
    return true;
  });

  assert.equal(exit.mock.callCount(), 1);
  assert.match(errors[0] ?? '', /epic "EPIC-999" not found/i);
});
