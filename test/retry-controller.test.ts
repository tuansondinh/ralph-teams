/**
 * test/retry-controller.test.ts — Unit tests for retry-controller.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resetFailedEpics, collectFailedStories } from '../src/retry-controller';
import type { Prd } from '../src/prd-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-retry-test-'));
}

function writePrd(filePath: string, prd: Prd): string {
  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(prd, null, 2), 'utf-8');
  return filePath;
}

function readPrd(prdPath: string): Prd {
  return JSON.parse(fs.readFileSync(prdPath, 'utf-8')) as Prd;
}

function makePrd(epics: Prd['epics']): Prd {
  return { project: 'Test', epics };
}

// ---------------------------------------------------------------------------
// resetFailedEpics
// ---------------------------------------------------------------------------

describe('resetFailedEpics', () => {
  let tmpDir: string;

  before(() => { tmpDir = makeTmpDir(); });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('resets failed epics to pending', () => {
    const p = writePrd(path.join(tmpDir, 'p1.json'), makePrd([
      { id: 'EPIC-001', title: 'E1', status: 'failed', userStories: [] },
    ]));
    const reset = resetFailedEpics(p);
    assert.deepEqual(reset, ['EPIC-001']);
    assert.equal(readPrd(p).epics[0].status, 'pending');
  });

  it('resets partial epics to pending', () => {
    const p = writePrd(path.join(tmpDir, 'p2.json'), makePrd([
      { id: 'EPIC-002', title: 'E2', status: 'partial', userStories: [] },
    ]));
    const reset = resetFailedEpics(p);
    assert.deepEqual(reset, ['EPIC-002']);
    assert.equal(readPrd(p).epics[0].status, 'pending');
  });

  it('leaves completed epics unchanged', () => {
    const p = writePrd(path.join(tmpDir, 'p3.json'), makePrd([
      { id: 'EPIC-003', title: 'E3', status: 'completed', userStories: [] },
    ]));
    const reset = resetFailedEpics(p);
    assert.deepEqual(reset, []);
    assert.equal(readPrd(p).epics[0].status, 'completed');
  });

  it('leaves merge-failed epics unchanged', () => {
    const p = writePrd(path.join(tmpDir, 'p4.json'), makePrd([
      { id: 'EPIC-004', title: 'E4', status: 'merge-failed', userStories: [] },
    ]));
    const reset = resetFailedEpics(p);
    assert.deepEqual(reset, []);
    assert.equal(readPrd(p).epics[0].status, 'merge-failed');
  });

  it('leaves pending epics unchanged', () => {
    const p = writePrd(path.join(tmpDir, 'p5.json'), makePrd([
      { id: 'EPIC-005', title: 'E5', status: 'pending', userStories: [] },
    ]));
    const reset = resetFailedEpics(p);
    assert.deepEqual(reset, []);
    assert.equal(readPrd(p).epics[0].status, 'pending');
  });

  it('resets both failed and partial, skips completed and merge-failed', () => {
    const p = writePrd(path.join(tmpDir, 'p6.json'), makePrd([
      { id: 'EPIC-001', title: 'E1', status: 'completed', userStories: [] },
      { id: 'EPIC-002', title: 'E2', status: 'failed', userStories: [] },
      { id: 'EPIC-003', title: 'E3', status: 'partial', userStories: [] },
      { id: 'EPIC-004', title: 'E4', status: 'merge-failed', userStories: [] },
    ]));
    const reset = resetFailedEpics(p);
    assert.deepEqual(reset.sort(), ['EPIC-002', 'EPIC-003']);
    const after = readPrd(p).epics;
    assert.equal(after[0].status, 'completed');
    assert.equal(after[1].status, 'pending');
    assert.equal(after[2].status, 'pending');
    assert.equal(after[3].status, 'merge-failed');
  });

  it('keeps passes: false on failed stories within reset epics', () => {
    const p = writePrd(path.join(tmpDir, 'p7.json'), makePrd([
      {
        id: 'EPIC-001', title: 'E1', status: 'failed',
        userStories: [
          { id: 'US-001', title: 'S1', passes: true },
          { id: 'US-002', title: 'S2', passes: false },
        ],
      },
    ]));
    resetFailedEpics(p);
    const stories = readPrd(p).epics[0].userStories;
    assert.equal(stories[0].passes, true,  'passed story should remain passed');
    assert.equal(stories[1].passes, false, 'failed story should remain false');
  });

  it('returns empty array when no epics need resetting', () => {
    const p = writePrd(path.join(tmpDir, 'p8.json'), makePrd([
      { id: 'EPIC-001', title: 'E1', status: 'completed', userStories: [] },
      { id: 'EPIC-002', title: 'E2', status: 'merge-failed', userStories: [] },
    ]));
    const reset = resetFailedEpics(p);
    assert.deepEqual(reset, []);
  });
});

// ---------------------------------------------------------------------------
// collectFailedStories
// ---------------------------------------------------------------------------

describe('collectFailedStories', () => {
  let tmpDir: string;

  before(() => { tmpDir = makeTmpDir(); });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty array when all stories pass', () => {
    const p = writePrd(path.join(tmpDir, 'c1.json'), makePrd([
      {
        id: 'EPIC-001', title: 'E1', status: 'completed',
        userStories: [
          { id: 'US-001', title: 'S1', passes: true },
          { id: 'US-002', title: 'S2', passes: true },
        ],
      },
    ]));
    assert.deepEqual(collectFailedStories(p), []);
  });

  it('identifies failed stories within a partial epic', () => {
    const p = writePrd(path.join(tmpDir, 'c2.json'), makePrd([
      {
        id: 'EPIC-001', title: 'E1', status: 'partial',
        userStories: [
          { id: 'US-001', title: 'S1', passes: true },
          { id: 'US-002', title: 'S2', passes: false },
          { id: 'US-003', title: 'S3', passes: false },
        ],
      },
    ]));
    const groups = collectFailedStories(p);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].epicId, 'EPIC-001');
    assert.deepEqual(groups[0].storyIds.sort(), ['US-002', 'US-003']);
  });

  it('groups failed stories by epic', () => {
    const p = writePrd(path.join(tmpDir, 'c3.json'), makePrd([
      {
        id: 'EPIC-001', title: 'E1', status: 'partial',
        userStories: [
          { id: 'US-001', title: 'S1', passes: false },
        ],
      },
      {
        id: 'EPIC-002', title: 'E2', status: 'failed',
        userStories: [
          { id: 'US-010', title: 'S10', passes: false },
          { id: 'US-011', title: 'S11', passes: false },
        ],
      },
    ]));
    const groups = collectFailedStories(p);
    assert.equal(groups.length, 2);
    const byEpic = Object.fromEntries(groups.map(g => [g.epicId, g.storyIds]));
    assert.deepEqual(byEpic['EPIC-001'], ['US-001']);
    assert.deepEqual(byEpic['EPIC-002'].sort(), ['US-010', 'US-011']);
  });

  it('includes stories with passes: false regardless of epic status', () => {
    // Even a "completed" epic might have a story with passes: false (edge case)
    const p = writePrd(path.join(tmpDir, 'c4.json'), makePrd([
      {
        id: 'EPIC-001', title: 'E1', status: 'completed',
        userStories: [
          { id: 'US-001', title: 'S1', passes: false },
        ],
      },
    ]));
    const groups = collectFailedStories(p);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].epicId, 'EPIC-001');
  });

  it('returns empty for empty epic list', () => {
    const p = writePrd(path.join(tmpDir, 'c5.json'), makePrd([]));
    assert.deepEqual(collectFailedStories(p), []);
  });
});
