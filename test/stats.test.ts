import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { statsCommand, StatsDeps } from '../src/commands/stats';
import { createEmptyRunStats, updateStoryStats, saveRunStats, StoryStats } from '../src/run-stats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-stats-cmd-'));
}

function makeStory(overrides: Partial<StoryStats> = {}): StoryStats {
  return {
    storyId: 'US-001',
    epicId: 'EPIC-001',
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: 0.05,
    startedAt: '2024-06-01T10:00:00.000Z',
    completedAt: '2024-06-01T10:05:00.000Z',
    durationMs: 300_000,
    durationFormatted: '5m 0s',
    passed: true,
    ...overrides,
  };
}

/** Builds a deps object that captures all log() calls into an array. */
function captureDeps(statsPath: string, fileExists: boolean = true): { deps: StatsDeps; lines: string[] } {
  const lines: string[] = [];
  const deps: StatsDeps = {
    loadRunStats: (p: string) => {
      // Use real loadRunStats on the actual file
      const { loadRunStats } = require('../src/run-stats');
      return loadRunStats(p);
    },
    existsSync: () => fileExists,
    log: (msg: string) => lines.push(msg),
  };
  return { deps, lines };
}

// ---------------------------------------------------------------------------
// statsCommand — file not found
// ---------------------------------------------------------------------------

test('statsCommand prints "No run stats found." when file does not exist', () => {
  const { deps, lines } = captureDeps('/nonexistent/path.json', false);

  statsCommand('/nonexistent/path.json', deps);

  assert.ok(lines.some(l => l.includes('No run stats found.')), `Expected "No run stats found." in output: ${lines.join('\n')}`);
});

// ---------------------------------------------------------------------------
// statsCommand — with data
// ---------------------------------------------------------------------------

test('statsCommand displays formatted output when stats file has data', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  // Build and save stats with one epic and two stories
  let stats = createEmptyRunStats();
  stats = updateStoryStats(stats, makeStory({
    storyId: 'US-001',
    epicId: 'EPIC-001',
    costUsd: 0.05,
    passed: true,
    durationFormatted: '5m 0s',
    durationMs: 300_000,
  }), 2);
  stats = updateStoryStats(stats, makeStory({
    storyId: 'US-002',
    epicId: 'EPIC-001',
    costUsd: 0.10,
    passed: false,
    startedAt: '2024-06-01T10:06:00.000Z',
    completedAt: '2024-06-01T10:09:00.000Z',
    durationMs: 180_000,
    durationFormatted: '3m 0s',
  }), 2);
  saveRunStats(statsPath, stats);

  const lines: string[] = [];
  const deps: StatsDeps = {
    loadRunStats: (p: string) => {
      const { loadRunStats } = require('../src/run-stats');
      return loadRunStats(p);
    },
    existsSync: () => true,
    log: (msg: string) => lines.push(msg),
  };

  statsCommand(statsPath, deps);

  const output = lines.join('\n');

  // Headers present
  assert.ok(output.includes('Ralph Run Stats'), `Missing header in:\n${output}`);
  assert.ok(output.includes('Epics:'), `Missing Epics section in:\n${output}`);
  assert.ok(output.includes('Totals:'), `Missing Totals section in:\n${output}`);
  assert.ok(output.includes('Estimates:'), `Missing Estimates section in:\n${output}`);

  // Epic ID appears
  assert.ok(output.includes('EPIC-001'), `Missing EPIC-001 in:\n${output}`);

  // Story IDs appear
  assert.ok(output.includes('US-001'), `Missing US-001 in:\n${output}`);
  assert.ok(output.includes('US-002'), `Missing US-002 in:\n${output}`);

  // Cost data appears
  assert.ok(output.includes('$'), `Missing cost data in:\n${output}`);

  // Pass/fail stats in totals
  assert.ok(output.includes('1/2'), `Missing 1/2 passed in:\n${output}`);

  fs.rmSync(tmpDir, { recursive: true });
});

test('statsCommand shows stories remaining in estimates section', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  let stats = createEmptyRunStats();
  // 1 of 5 stories completed
  stats = updateStoryStats(stats, makeStory({ costUsd: 0.10, passed: true }), 5);
  saveRunStats(statsPath, stats);

  const lines: string[] = [];
  const deps: StatsDeps = {
    loadRunStats: (p: string) => {
      const { loadRunStats } = require('../src/run-stats');
      return loadRunStats(p);
    },
    existsSync: () => true,
    log: (msg: string) => lines.push(msg),
  };

  statsCommand(statsPath, deps);

  const output = lines.join('\n');
  assert.ok(output.includes('Stories remaining: 4'), `Expected "Stories remaining: 4" in:\n${output}`);

  fs.rmSync(tmpDir, { recursive: true });
});

test('statsCommand shows estimated cost when available', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  let stats = createEmptyRunStats();
  stats = updateStoryStats(stats, makeStory({ costUsd: 0.10, passed: true }), 3);
  saveRunStats(statsPath, stats);

  const lines: string[] = [];
  const deps: StatsDeps = {
    loadRunStats: (p: string) => {
      const { loadRunStats } = require('../src/run-stats');
      return loadRunStats(p);
    },
    existsSync: () => true,
    log: (msg: string) => lines.push(msg),
  };

  statsCommand(statsPath, deps);

  const output = lines.join('\n');
  // 1 of 3 done at $0.10, avg=$0.10, remaining=2, est = $0.30
  assert.ok(output.includes('$0.30'), `Expected estimated total $0.30 in:\n${output}`);

  fs.rmSync(tmpDir, { recursive: true });
});
