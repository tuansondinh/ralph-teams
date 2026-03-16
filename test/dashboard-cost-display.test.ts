/**
 * test/dashboard-cost-display.test.ts — Tests for cost/time display functions.
 *
 * Covers:
 * - computeEpicCostEstimate / computeEpicTimeEstimate (poller.ts)
 * - renderHeader with cost/time estimates (renderer.ts)
 * - renderEpicRow with cost/time columns (renderer.ts)
 * - renderMergeStatusLine (renderer.ts)
 * - buildStateFromFiles wiring of estimates and merge events (poller.ts)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEpicCostEstimate,
  computeEpicTimeEstimate,
  buildStateFromFiles,
} from '../src/dashboard/poller';
import {
  renderHeader,
  renderEpicRow,
  renderMergeStatusLine,
  renderEpicList,
} from '../src/dashboard/renderer';
import { DashboardState, EpicDisplayData } from '../src/dashboard/types';

// ---------------------------------------------------------------------------
// computeEpicCostEstimate
// ---------------------------------------------------------------------------

describe('computeEpicCostEstimate', () => {
  it('returns null when avgCostPerStory is null', () => {
    assert.equal(computeEpicCostEstimate(null, 3, null), null);
    assert.equal(computeEpicCostEstimate(0.5, 3, null), null);
  });

  it('returns null when storiesRemaining is 0 (done)', () => {
    assert.equal(computeEpicCostEstimate(1.0, 0, 0.2), null);
  });

  it('returns null when storiesRemaining is negative', () => {
    assert.equal(computeEpicCostEstimate(1.0, -1, 0.2), null);
  });

  it('returns estimate when actualCost is null (no stories completed yet)', () => {
    // 0 actual + 0.20 * 3 = 0.60
    const result = computeEpicCostEstimate(null, 3, 0.20);
    assert.equal(result, '~$0.60');
  });

  it('returns estimate combining actual and projected', () => {
    // 0.50 actual + 0.20 * 2 = 0.90
    const result = computeEpicCostEstimate(0.50, 2, 0.20);
    assert.equal(result, '~$0.90');
  });

  it('rounds to 2 decimal places', () => {
    const result = computeEpicCostEstimate(0.10, 1, 0.005);
    // 0.10 + 0.005 = 0.105 → toFixed(2) = '0.11'
    assert.equal(result, '~$0.11');
  });
});

// ---------------------------------------------------------------------------
// computeEpicTimeEstimate
// ---------------------------------------------------------------------------

describe('computeEpicTimeEstimate', () => {
  it('returns null when avgTimePerStoryMs is null', () => {
    assert.equal(computeEpicTimeEstimate(null, 3, null), null);
  });

  it('returns null when storiesRemaining is 0', () => {
    assert.equal(computeEpicTimeEstimate('5m 0s', 0, 300000), null);
  });

  it('returns null when storiesRemaining is negative', () => {
    assert.equal(computeEpicTimeEstimate(null, -1, 60000), null);
  });

  it('returns formatted remaining estimate', () => {
    // 2 stories * 60000ms = 120000ms = 2m 0s
    const result = computeEpicTimeEstimate(null, 2, 60000);
    assert.equal(result, '~2m 0s remaining');
  });

  it('ignores actualTime (not used in calculation)', () => {
    // Only remaining matters here
    const result = computeEpicTimeEstimate('10m 0s', 1, 60000);
    assert.equal(result, '~1m 0s remaining');
  });
});

// ---------------------------------------------------------------------------
// renderHeader — with estimates
// ---------------------------------------------------------------------------

describe('renderHeader with estimates', () => {
  const baseState: DashboardState = {
    projectName: 'MyProject',
    currentWave: 2,
    startedAt: null,
    epics: [],
    totalCostUsd: 1.23,
    totalCostEstimate: null,
    totalElapsed: '5m 0s',
    totalTimeEstimate: null,
    viewMode: 'dashboard',
    selectedEpicId: null,
    rawLogLines: [],
    mergeEvents: [],
    awaitingEpicNumber: false,
    runComplete: false,
  };

  it('renders basic two-line header with no estimates', () => {
    const lines = renderHeader(baseState);
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('MyProject'));
    assert.ok(lines[1].includes('Wave 2'));
    assert.ok(lines[1].includes('$1.23'));
    assert.ok(lines[1].includes('5m 0s'));
  });

  it('adds estimate line when totalCostEstimate is set', () => {
    const state = { ...baseState, totalCostEstimate: '$2.50' };
    const lines = renderHeader(state);
    assert.equal(lines.length, 3);
    assert.ok(lines[2].includes('Est. total: $2.50'));
  });

  it('adds estimate line when totalTimeEstimate is set', () => {
    const state = { ...baseState, totalTimeEstimate: '15m 0s' };
    const lines = renderHeader(state);
    assert.equal(lines.length, 3);
    assert.ok(lines[2].includes('Est. time: 15m 0s'));
  });

  it('combines both estimates in one line with separator', () => {
    const state = {
      ...baseState,
      totalCostEstimate: '$3.00',
      totalTimeEstimate: '20m 0s',
    };
    const lines = renderHeader(state);
    assert.equal(lines.length, 3);
    assert.ok(lines[2].includes('Est. total: $3.00'));
    assert.ok(lines[2].includes('Est. time: 20m 0s'));
  });

  it('shows -- for totalCostUsd when null', () => {
    const state = { ...baseState, totalCostUsd: null };
    const lines = renderHeader(state);
    assert.ok(lines[1].includes('Cost: --'));
  });
});

// ---------------------------------------------------------------------------
// renderEpicRow — cost/time display
// ---------------------------------------------------------------------------

describe('renderEpicRow with cost/time display', () => {
  const baseEpic: EpicDisplayData = {
    id: 'EPIC-001',
    title: 'Foundation',
    status: 'pending',
    storiesPassed: 2,
    storiesTotal: 5,
    stories: [],
    currentActivity: 'pending',
    costActual: null,
    costEstimate: null,
    timeActual: null,
    timeEstimate: null,
    mergeStatus: null,
  };

  it('shows -- for cost and time when both are null', () => {
    const row = renderEpicRow(baseEpic);
    assert.ok(row.includes('cost:--'));
    assert.ok(row.includes('time:--'));
  });

  it('shows estimate when no actual cost available', () => {
    const epic = { ...baseEpic, costEstimate: '~$0.60' };
    const row = renderEpicRow(epic);
    assert.ok(row.includes('cost:~$0.60'));
  });

  it('shows actual cost when available', () => {
    const epic = { ...baseEpic, costActual: 0.75 };
    const row = renderEpicRow(epic);
    assert.ok(row.includes('cost:$0.75'));
  });

  it('shows actual cost with estimate in parens when both available', () => {
    const epic = { ...baseEpic, costActual: 0.75, costEstimate: '~$1.20' };
    const row = renderEpicRow(epic);
    assert.ok(row.includes('cost:$0.75 (est:~$1.20)'));
  });

  it('shows timeActual when available', () => {
    const epic = { ...baseEpic, timeActual: '3m 45s' };
    const row = renderEpicRow(epic);
    assert.ok(row.includes('time:3m 45s'));
  });

  it('shows timeEstimate when no actual time', () => {
    const epic = { ...baseEpic, timeEstimate: '~5m 0s remaining' };
    const row = renderEpicRow(epic);
    assert.ok(row.includes('time:~5m 0s remaining'));
  });

  it('shows merge status suffix when mergeStatus is set', () => {
    const epic = { ...baseEpic, mergeStatus: 'failed' };
    const row = renderEpicRow(epic);
    assert.ok(row.includes('[merge:failed]'));
  });

  it('no merge suffix when mergeStatus is null', () => {
    const row = renderEpicRow(baseEpic);
    assert.ok(!row.includes('[merge:'));
  });
});

// ---------------------------------------------------------------------------
// renderMergeStatusLine
// ---------------------------------------------------------------------------

describe('renderMergeStatusLine', () => {
  const epic: EpicDisplayData = {
    id: 'EPIC-001',
    title: 'Foundation',
    status: 'completed',
    storiesPassed: 5,
    storiesTotal: 5,
    stories: [],
    currentActivity: 'done',
    costActual: null,
    costEstimate: null,
    timeActual: null,
    timeEstimate: null,
    mergeStatus: null,
  };

  it('returns null when no merge event for this epic', () => {
    const result = renderMergeStatusLine(epic, []);
    assert.equal(result, null);
  });

  it('returns null when merge events exist but not for this epic', () => {
    const result = renderMergeStatusLine(epic, [
      { epicId: 'EPIC-002', status: 'merged-clean', detail: 'clean' },
    ]);
    assert.equal(result, null);
  });

  it('renders merging status', () => {
    const result = renderMergeStatusLine(epic, [
      { epicId: 'EPIC-001', status: 'merging', detail: 'resolving conflicts' },
    ]);
    assert.equal(result, '    merge: resolving conflicts...');
  });

  it('renders merged-clean status', () => {
    const result = renderMergeStatusLine(epic, [
      { epicId: 'EPIC-001', status: 'merged-clean', detail: 'clean' },
    ]);
    assert.equal(result, '    merge: done (clean)');
  });

  it('renders merged-ai status', () => {
    const result = renderMergeStatusLine(epic, [
      { epicId: 'EPIC-001', status: 'merged-ai', detail: 'AI-resolved' },
    ]);
    assert.equal(result, '    merge: done (AI-resolved)');
  });

  it('renders merge-failed status with detail', () => {
    const result = renderMergeStatusLine(epic, [
      { epicId: 'EPIC-001', status: 'merge-failed', detail: 'src/api.ts src/utils.ts' },
    ]);
    assert.equal(result, '    merge: FAILED — src/api.ts src/utils.ts');
  });
});

// ---------------------------------------------------------------------------
// buildStateFromFiles — wiring estimates and merge events
// ---------------------------------------------------------------------------

describe('buildStateFromFiles estimates and merge wiring', () => {
  const prdContent = JSON.stringify({
    project: 'TestProject',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Foundation',
        status: 'pending',
        dependsOn: [],
        userStories: [
          { id: 'US-001', title: 'Story One', passes: false },
          { id: 'US-002', title: 'Story Two', passes: false },
        ],
      },
    ],
  });

  const statsContent = JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    epics: [],
    totals: {
      inputTokens: null,
      outputTokens: null,
      costUsd: 0.50,
      storiesPassed: 0,
      storiesTotal: 2,
      startedAt: null,
      durationMs: null,
      durationFormatted: null,
    },
    estimates: {
      estimatedTotalCostUsd: '$1.50',
      estimatedTotalTimeMs: 180000,
      estimatedTotalTimeFormatted: '3m 0s',
      averageCostPerStory: 0.25,
      averageTimePerStoryMs: 90000,
      storiesRemaining: 2,
    },
  });

  it('populates totalCostEstimate from stats estimates', () => {
    const state = buildStateFromFiles(prdContent, null, statsContent, 'Fallback');
    assert.equal(state.totalCostEstimate, '$1.50');
  });

  it('populates totalTimeEstimate from stats estimates', () => {
    const state = buildStateFromFiles(prdContent, null, statsContent, 'Fallback');
    assert.equal(state.totalTimeEstimate, '3m 0s');
  });

  it('has null totalCostEstimate when no stats content', () => {
    const state = buildStateFromFiles(prdContent, null, null, 'Fallback');
    assert.equal(state.totalCostEstimate, null);
  });

  it('has null totalTimeEstimate when no stats content', () => {
    const state = buildStateFromFiles(prdContent, null, null, 'Fallback');
    assert.equal(state.totalTimeEstimate, null);
  });

  it('parses merge events from progress content', () => {
    const progress = '[EPIC-001] MERGED (clean) — Mon Jan  1 00:00:00 UTC 2024\n';
    const state = buildStateFromFiles(prdContent, progress, null, 'Fallback');
    assert.equal(state.mergeEvents.length, 1);
    assert.equal(state.mergeEvents[0].epicId, 'EPIC-001');
    assert.equal(state.mergeEvents[0].status, 'merged-clean');
  });

  it('has empty mergeEvents when no progress content', () => {
    const state = buildStateFromFiles(prdContent, null, null, 'Fallback');
    assert.deepEqual(state.mergeEvents, []);
  });

  it('passes averages from stats to per-epic cost estimate', () => {
    // EPIC-001 has 2 stories, none passed; avg 0.25 → estimate ~$0.50
    const state = buildStateFromFiles(prdContent, null, statsContent, 'Fallback');
    const epic = state.epics.find(e => e.id === 'EPIC-001');
    assert.ok(epic, 'EPIC-001 should exist');
    assert.equal(epic?.costEstimate, '~$0.50');
  });
});

// ---------------------------------------------------------------------------
// renderEpicList — merge status integration
// ---------------------------------------------------------------------------

describe('renderEpicList with merge events', () => {
  const stateWithMerge: DashboardState = {
    projectName: 'TestProject',
    currentWave: 1,
    startedAt: null,
    epics: [
      {
        id: 'EPIC-001',
        title: 'Foundation',
        status: 'completed',
        storiesPassed: 5,
        storiesTotal: 5,
        stories: [],
        currentActivity: 'done',
        costActual: 0.75,
        costEstimate: null,
        timeActual: '5m 0s',
        timeEstimate: null,
        mergeStatus: null,
      },
    ],
    totalCostUsd: 0.75,
    totalCostEstimate: null,
    totalElapsed: '10m 0s',
    totalTimeEstimate: null,
    viewMode: 'dashboard',
    selectedEpicId: null,
    rawLogLines: [],
    mergeEvents: [
      { epicId: 'EPIC-001', status: 'merged-clean', detail: 'clean' },
    ],
    awaitingEpicNumber: false,
    runComplete: false,
  };

  it('includes merge status line for epic with merge event', () => {
    const output = renderEpicList(stateWithMerge);
    assert.ok(output.includes('merge: done (clean)'));
  });

  it('does not include merge status line when no merge events', () => {
    const state = { ...stateWithMerge, mergeEvents: [] };
    const output = renderEpicList(state);
    assert.ok(!output.includes('merge:'));
  });
});
