/**
 * test/dashboard-screen.test.ts — Tests for the dashboard rendering functions.
 *
 * Tests pure formatting functions extracted from renderer.ts.
 * Does NOT test blessed rendering directly (no terminal required).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatProgressBar,
  formatCost,
  epicStatusSymbol,
  renderHeader,
  renderEpicRow,
  renderFooter,
  renderEpicList,
  renderStoryRow,
} from '../src/dashboard/renderer';
import type { DashboardState, EpicDisplayData } from '../src/dashboard/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEpic(overrides: Partial<EpicDisplayData> = {}): EpicDisplayData {
  return {
    id: 'EPIC-001',
    title: 'First Epic',
    status: 'pending',
    storiesPassed: 0,
    storiesTotal: 5,
    stories: [],
    currentActivity: 'pending',
    costActual: null,
    costEstimate: null,
    timeActual: null,
    timeEstimate: null,
    mergeStatus: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    projectName: 'My Project',
    currentWave: 1,
    startedAt: null,
    epics: [],
    totalCostUsd: null,
    totalElapsed: '--',
    viewMode: 'dashboard',
    selectedEpicId: null,
    rawLogLines: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatProgressBar
// ---------------------------------------------------------------------------

test('formatProgressBar with zero total returns all dashes', () => {
  const result = formatProgressBar(0, 0);
  assert.equal(result, '[----------] 0/0');
});

test('formatProgressBar with all passed returns all hashes', () => {
  const result = formatProgressBar(5, 5);
  assert.equal(result, '[##########] 5/5');
});

test('formatProgressBar with half passed returns half hashes', () => {
  const result = formatProgressBar(5, 10);
  assert.equal(result, '[#####-----] 5/10');
});

test('formatProgressBar with no passed returns all dashes', () => {
  const result = formatProgressBar(0, 5);
  assert.equal(result, '[----------] 0/5');
});

test('formatProgressBar respects custom width', () => {
  const result = formatProgressBar(2, 4, 4);
  assert.equal(result, '[##--] 2/4');
});

test('formatProgressBar clamps above 100%', () => {
  const result = formatProgressBar(6, 5);
  assert.equal(result, '[##########] 6/5');
});

// ---------------------------------------------------------------------------
// formatCost
// ---------------------------------------------------------------------------

test('formatCost returns "--" for null', () => {
  assert.equal(formatCost(null), '--');
});

test('formatCost returns dollar-prefixed string for 0', () => {
  assert.equal(formatCost(0), '$0.00');
});

test('formatCost returns dollar-prefixed string for positive value', () => {
  assert.equal(formatCost(1.234), '$1.23');
});

test('formatCost rounds to 2 decimal places', () => {
  assert.equal(formatCost(0.999), '$1.00');
});

// ---------------------------------------------------------------------------
// epicStatusSymbol
// ---------------------------------------------------------------------------

test('epicStatusSymbol returns [DONE] for completed', () => {
  assert.equal(epicStatusSymbol('completed'), '[DONE]');
});

test('epicStatusSymbol returns [FAIL] for failed', () => {
  assert.equal(epicStatusSymbol('failed'), '[FAIL]');
});

test('epicStatusSymbol returns [MRG!] for merge-failed', () => {
  assert.equal(epicStatusSymbol('merge-failed'), '[MRG!]');
});

test('epicStatusSymbol returns [PART] for partial', () => {
  assert.equal(epicStatusSymbol('partial'), '[PART]');
});

test('epicStatusSymbol returns [    ] for pending/unknown', () => {
  assert.equal(epicStatusSymbol('pending'), '[    ]');
  assert.equal(epicStatusSymbol('unknown'), '[    ]');
});

// ---------------------------------------------------------------------------
// renderHeader
// ---------------------------------------------------------------------------

test('renderHeader includes project name', () => {
  const state = makeState({ projectName: 'Ralph Demo' });
  const lines = renderHeader(state);
  assert.ok(lines.some(l => l.includes('Ralph Demo')), 'header should contain project name');
});

test('renderHeader includes wave number', () => {
  const state = makeState({ currentWave: 3 });
  const lines = renderHeader(state);
  assert.ok(lines.some(l => l.includes('Wave 3')), 'header should contain wave number');
});

test('renderHeader shows Wave -- when wave is 0', () => {
  const state = makeState({ currentWave: 0 });
  const lines = renderHeader(state);
  assert.ok(lines.some(l => l.includes('Wave --')), 'header should show Wave --');
});

test('renderHeader shows cost when available', () => {
  const state = makeState({ totalCostUsd: 1.5 });
  const lines = renderHeader(state);
  assert.ok(lines.some(l => l.includes('$1.50')), 'header should show cost');
});

test('renderHeader shows -- cost when null', () => {
  const state = makeState({ totalCostUsd: null });
  const lines = renderHeader(state);
  assert.ok(lines.some(l => l.includes('Cost: --')), 'header should show -- cost');
});

// ---------------------------------------------------------------------------
// renderEpicRow
// ---------------------------------------------------------------------------

test('renderEpicRow includes epic id and title', () => {
  const epic = makeEpic({ id: 'EPIC-001', title: 'My Test Epic' });
  const row = renderEpicRow(epic);
  assert.ok(row.includes('EPIC-001'), 'row should include epic id');
  assert.ok(row.includes('My Test Epic'), 'row should include epic title');
});

test('renderEpicRow includes progress bar', () => {
  const epic = makeEpic({ storiesPassed: 3, storiesTotal: 5 });
  const row = renderEpicRow(epic);
  assert.ok(row.includes('3/5'), 'row should include story count');
  assert.ok(row.includes('['), 'row should include progress bar');
});

test('renderEpicRow includes [DONE] for completed epic', () => {
  const epic = makeEpic({ status: 'completed' });
  const row = renderEpicRow(epic);
  assert.ok(row.includes('[DONE]'), 'completed epic row should include [DONE]');
});

test('renderEpicRow shows actual cost when available', () => {
  const epic = makeEpic({ costActual: 0.45 });
  const row = renderEpicRow(epic);
  assert.ok(row.includes('$0.45'), 'row should include actual cost');
});

test('renderEpicRow shows -- cost when null', () => {
  const epic = makeEpic({ costActual: null, costEstimate: null });
  const row = renderEpicRow(epic);
  assert.ok(row.includes('cost:--'), 'row should show -- cost');
});

test('renderEpicRow truncates long titles at 28 characters', () => {
  const longTitle = 'A'.repeat(50);
  const epic = makeEpic({ title: longTitle });
  const row = renderEpicRow(epic);
  // Title portion in row should be 28 chars (padded)
  assert.ok(!row.includes('A'.repeat(29)), 'title should be truncated to 28 chars');
});

// ---------------------------------------------------------------------------
// renderStoryRow
// ---------------------------------------------------------------------------

test('renderStoryRow includes story id and title', () => {
  const story = { id: 'US-001', title: 'My Story', state: 'pass', duration: null };
  const row = renderStoryRow(story);
  assert.ok(row.includes('US-001'), 'story row should include id');
  assert.ok(row.includes('My Story'), 'story row should include title');
});

test('renderStoryRow shows [ PASS ] for pass state', () => {
  const story = { id: 'US-001', title: 'Story', state: 'pass', duration: null };
  assert.ok(renderStoryRow(story).includes('[ PASS ]'));
});

test('renderStoryRow shows [ FAIL ] for fail state', () => {
  const story = { id: 'US-001', title: 'Story', state: 'fail', duration: null };
  assert.ok(renderStoryRow(story).includes('[ FAIL ]'));
});

test('renderStoryRow shows duration when available', () => {
  const story = { id: 'US-001', title: 'Story', state: 'pass', duration: '3m 15s' };
  assert.ok(renderStoryRow(story).includes('3m 15s'));
});

// ---------------------------------------------------------------------------
// renderFooter
// ---------------------------------------------------------------------------

test('renderFooter includes quit keybinding', () => {
  const footer = renderFooter();
  assert.ok(footer.includes('q:quit'), 'footer should include q:quit');
});

test('renderFooter includes expected keys', () => {
  const footer = renderFooter();
  assert.ok(footer.includes('r:refresh'));
  assert.ok(footer.includes('d:dashboard'));
  assert.ok(footer.includes('l:logs'));
});

// ---------------------------------------------------------------------------
// renderEpicList
// ---------------------------------------------------------------------------

test('renderEpicList returns placeholder message when no epics', () => {
  const state = makeState({ epics: [] });
  const content = renderEpicList(state);
  assert.ok(content.includes('no epics found'), 'should show placeholder for empty list');
});

test('renderEpicList renders one row per epic', () => {
  const state = makeState({
    epics: [
      makeEpic({ id: 'EPIC-001', title: 'First' }),
      makeEpic({ id: 'EPIC-002', title: 'Second' }),
    ],
  });
  const content = renderEpicList(state);
  assert.ok(content.includes('EPIC-001'), 'should render EPIC-001');
  assert.ok(content.includes('EPIC-002'), 'should render EPIC-002');
});
