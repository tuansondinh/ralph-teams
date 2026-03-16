/**
 * test/dashboard-poller.test.ts — Tests for the dashboard file polling engine.
 *
 * Tests pure parsing functions and the poller's mtime caching behavior.
 * Uses temp directories with fixture files.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseEpicsFromPrd,
  parseWaveFromProgress,
  buildStateFromFiles,
  createPoller,
} from '../src/dashboard/poller';
import type { DashboardOptions } from '../src/dashboard/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SIMPLE_PRD = JSON.stringify({
  project: 'Test Project',
  epics: [
    {
      id: 'EPIC-001',
      title: 'First Epic',
      status: 'completed',
      userStories: [
        { id: 'US-001', title: 'Story 1', passes: true },
        { id: 'US-002', title: 'Story 2', passes: true },
      ],
    },
    {
      id: 'EPIC-002',
      title: 'Second Epic',
      status: 'pending',
      userStories: [
        { id: 'US-003', title: 'Story 3', passes: false },
      ],
    },
  ],
});

const SIMPLE_STATS = JSON.stringify({
  version: 1,
  updatedAt: '2024-01-01T00:00:00Z',
  epics: [
    {
      epicId: 'EPIC-001',
      stories: [],
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalCostUsd: 0.12,
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-01T00:05:00Z',
      durationMs: 300000,
      durationFormatted: '5m 0s',
      storiesPassed: 2,
      storiesTotal: 2,
    },
  ],
  totals: {
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: 0.12,
    storiesPassed: 2,
    storiesTotal: 3,
    startedAt: '2024-01-01T00:00:00Z',
    durationMs: null,
    durationFormatted: null,
  },
  estimates: {
    estimatedTotalCostUsd: '$0.18',
    estimatedTotalTimeMs: null,
    estimatedTotalTimeFormatted: '--',
    averageCostPerStory: 0.06,
    averageTimePerStoryMs: null,
    storiesRemaining: 1,
  },
});

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-dashboard-'));
}

// ---------------------------------------------------------------------------
// parseEpicsFromPrd
// ---------------------------------------------------------------------------

test('parseEpicsFromPrd returns empty array for invalid JSON', () => {
  const result = parseEpicsFromPrd('not-json', []);
  assert.deepEqual(result, []);
});

test('parseEpicsFromPrd returns correct epic display data', () => {
  const epics = parseEpicsFromPrd(SIMPLE_PRD, []);
  assert.equal(epics.length, 2);
  assert.equal(epics[0].id, 'EPIC-001');
  assert.equal(epics[0].title, 'First Epic');
  assert.equal(epics[0].status, 'completed');
  assert.equal(epics[0].storiesPassed, 2);
  assert.equal(epics[0].storiesTotal, 2);
});

test('parseEpicsFromPrd merges cost data from stats', () => {
  const statsEpics = JSON.parse(SIMPLE_STATS).epics;
  const epics = parseEpicsFromPrd(SIMPLE_PRD, statsEpics);
  assert.equal(epics[0].costActual, 0.12);
  assert.equal(epics[0].timeActual, '5m 0s');
  // EPIC-002 has no stats
  assert.equal(epics[1].costActual, null);
  assert.equal(epics[1].timeActual, null);
});

test('parseEpicsFromPrd builds story display data', () => {
  const epics = parseEpicsFromPrd(SIMPLE_PRD, []);
  const stories = epics[0].stories;
  assert.equal(stories.length, 2);
  assert.equal(stories[0].id, 'US-001');
  assert.equal(stories[0].state, 'pass');
  // Pending epic story that hasn't passed -> queued
  const pendingEpicStories = epics[1].stories;
  assert.equal(pendingEpicStories[0].state, 'queued');
});

// ---------------------------------------------------------------------------
// parseWaveFromProgress
// ---------------------------------------------------------------------------

test('parseWaveFromProgress returns 0 for empty content', () => {
  assert.equal(parseWaveFromProgress(''), 0);
});

test('parseWaveFromProgress returns 0 when no wave line present', () => {
  assert.equal(parseWaveFromProgress('some log line\nanother line'), 0);
});

test('parseWaveFromProgress returns the last wave number found', () => {
  const content = `
=== Wave 1 ===
Starting epic EPIC-001
=== Wave 2 ===
Starting epic EPIC-002
=== Wave 3 ===
`.trim();
  assert.equal(parseWaveFromProgress(content), 3);
});

test('parseWaveFromProgress returns the only wave number when single wave', () => {
  assert.equal(parseWaveFromProgress('=== Wave 1 ==='), 1);
});

// ---------------------------------------------------------------------------
// buildStateFromFiles
// ---------------------------------------------------------------------------

test('buildStateFromFiles returns defaults when all inputs are null', () => {
  const state = buildStateFromFiles(null, null, null, 'MyProject');
  assert.equal(state.projectName, 'MyProject');
  assert.equal(state.currentWave, 0);
  assert.equal(state.epics.length, 0);
  assert.equal(state.totalCostUsd, null);
  assert.equal(state.totalElapsed, '--');
  assert.equal(state.viewMode, 'dashboard');
});

test('buildStateFromFiles extracts project name from prd.json', () => {
  const state = buildStateFromFiles(SIMPLE_PRD, null, null, 'fallback');
  assert.equal(state.projectName, 'Test Project');
});

test('buildStateFromFiles parses wave from progress content', () => {
  const state = buildStateFromFiles(null, '=== Wave 5 ===', null, 'Test');
  assert.equal(state.currentWave, 5);
});

test('buildStateFromFiles extracts cost from stats', () => {
  const state = buildStateFromFiles(SIMPLE_PRD, null, SIMPLE_STATS, 'Test');
  assert.equal(state.totalCostUsd, 0.12);
});

test('buildStateFromFiles handles invalid stats JSON gracefully', () => {
  const state = buildStateFromFiles(null, null, '{invalid}', 'Test');
  assert.equal(state.totalCostUsd, null);
});

// ---------------------------------------------------------------------------
// createPoller — mtime caching and lifecycle
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('createPoller calls onUpdate when prd.json is created', async () => {
  const tempDir = makeTempDir();
  const prdPath = path.join(tempDir, 'prd.json');
  const progressPath = path.join(tempDir, 'progress.txt');
  const statsPath = path.join(tempDir, 'ralph-run-stats.json');

  fs.writeFileSync(prdPath, SIMPLE_PRD);

  const options: DashboardOptions = {
    prdPath,
    statsPath,
    logsDir: tempDir,
    progressPath,
    pollIntervalMs: 50,
  };

  const updates: Array<ReturnType<typeof buildStateFromFiles>> = [];
  const poller = createPoller(options, (state) => {
    updates.push(state);
  });

  poller.start();
  await delay(120);
  poller.stop();

  assert.ok(updates.length >= 1, 'expected at least one update');
  assert.equal(updates[0].epics.length, 2);
});

test('createPoller returns default state when prd.json is missing', async () => {
  const tempDir = makeTempDir();
  const prdPath = path.join(tempDir, 'prd.json');
  const progressPath = path.join(tempDir, 'progress.txt');
  const statsPath = path.join(tempDir, 'ralph-run-stats.json');

  const options: DashboardOptions = {
    prdPath,
    statsPath,
    logsDir: tempDir,
    progressPath,
    pollIntervalMs: 50,
  };

  const updates: Array<ReturnType<typeof buildStateFromFiles>> = [];
  const poller = createPoller(options, (state) => {
    updates.push(state);
  });

  // Write progress.txt to trigger first update (prd.json is missing)
  fs.writeFileSync(progressPath, '=== Wave 1 ===');
  poller.start();
  await delay(120);
  poller.stop();

  assert.ok(updates.length >= 1, 'expected at least one update');
  // Should return empty epics when prd.json is missing
  assert.equal(updates[0].epics.length, 0);
});

test('createPoller stop() prevents further updates', async () => {
  const tempDir = makeTempDir();
  const prdPath = path.join(tempDir, 'prd.json');
  const progressPath = path.join(tempDir, 'progress.txt');
  const statsPath = path.join(tempDir, 'ralph-run-stats.json');

  fs.writeFileSync(prdPath, SIMPLE_PRD);

  const options: DashboardOptions = {
    prdPath,
    statsPath,
    logsDir: tempDir,
    progressPath,
    pollIntervalMs: 50,
  };

  let callCount = 0;
  const poller = createPoller(options, () => {
    callCount++;
  });

  poller.start();
  // Let one tick fire
  await delay(80);
  poller.stop();
  const countAtStop = callCount;

  // Wait another interval period — no new calls expected after stop
  await delay(120);
  assert.ok(callCount <= countAtStop + 1, `Expected count to stop at ${countAtStop}, got ${callCount}`);
});

test('createPoller uses mtime caching — does not call onUpdate when file unchanged', async () => {
  const tempDir = makeTempDir();
  const prdPath = path.join(tempDir, 'prd.json');
  const progressPath = path.join(tempDir, 'progress.txt');
  const statsPath = path.join(tempDir, 'ralph-run-stats.json');

  fs.writeFileSync(prdPath, SIMPLE_PRD);

  const options: DashboardOptions = {
    prdPath,
    statsPath,
    logsDir: tempDir,
    progressPath,
    pollIntervalMs: 50,
  };

  let callCount = 0;
  const poller = createPoller(options, () => {
    callCount++;
  });

  poller.start();
  // Wait multiple poll intervals — file unchanged so should only trigger once
  await delay(200);
  poller.stop();

  // Should have been called once initially (file present at start), then no more
  assert.equal(callCount, 1, `Expected 1 update (mtime cache), got ${callCount}`);
});
