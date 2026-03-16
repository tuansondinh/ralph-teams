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
  storyStateIcon,
  renderActivityLine,
} from '../src/dashboard/renderer';
import type { StoryDisplayData } from '../src/dashboard/types';
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
    totalCostEstimate: null,
    totalElapsed: '--',
    totalTimeEstimate: null,
    viewMode: 'dashboard',
    selectedEpicId: null,
    rawLogLines: [],
    mergeEvents: [],
    awaitingEpicNumber: false,
    runComplete: false,
    retryCount: 0,
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
// storyStateIcon
// ---------------------------------------------------------------------------

test('storyStateIcon returns - for queued', () => {
  assert.equal(storyStateIcon('queued'), '-');
});

test('storyStateIcon returns > for building', () => {
  assert.equal(storyStateIcon('building'), '>');
});

test('storyStateIcon returns ? for validating', () => {
  assert.equal(storyStateIcon('validating'), '?');
});

test('storyStateIcon returns + for pass', () => {
  assert.equal(storyStateIcon('pass'), '+');
});

test('storyStateIcon returns x for fail', () => {
  assert.equal(storyStateIcon('fail'), 'x');
});

// ---------------------------------------------------------------------------
// renderStoryRow
// ---------------------------------------------------------------------------

function makeStory(overrides: Partial<StoryDisplayData> = {}): StoryDisplayData {
  return {
    id: 'US-001',
    title: 'My Story',
    state: 'queued',
    failureReason: null,
    duration: null,
    attempts: 0,
    cycles: [],
    ...overrides,
  };
}

test('renderStoryRow includes story id and title', () => {
  const story = makeStory({ id: 'US-001', title: 'My Story', state: 'pass' });
  const row = renderStoryRow(story);
  assert.ok(row.includes('US-001'), 'story row should include id');
  assert.ok(row.includes('My Story'), 'story row should include title');
});

test('renderStoryRow uses + icon and PASS label for pass state', () => {
  const story = makeStory({ state: 'pass' });
  const row = renderStoryRow(story);
  assert.ok(row.includes('+ '), 'pass row should include + icon');
  assert.ok(row.includes('PASS'), 'pass row should include PASS label');
});

test('renderStoryRow uses x icon and FAIL label for fail state', () => {
  const story = makeStory({ state: 'fail' });
  const row = renderStoryRow(story);
  assert.ok(row.includes('x '), 'fail row should include x icon');
  assert.ok(row.includes('FAIL'), 'fail row should include FAIL label');
});

test('renderStoryRow uses - icon for queued state', () => {
  const story = makeStory({ state: 'queued' });
  assert.ok(renderStoryRow(story).includes('- '));
});

test('renderStoryRow uses > icon for building state', () => {
  const story = makeStory({ state: 'building' });
  assert.ok(renderStoryRow(story).includes('> '));
});

test('renderStoryRow uses ? icon for validating state', () => {
  const story = makeStory({ state: 'validating' });
  assert.ok(renderStoryRow(story).includes('? '));
});

test('renderStoryRow shows duration for pass state', () => {
  const story = makeStory({ state: 'pass', duration: '3m 15s' });
  assert.ok(renderStoryRow(story).includes('3m 15s'));
});

test('renderStoryRow shows failure reason for fail state', () => {
  const story = makeStory({ state: 'fail', failureReason: 'typecheck passes not met' });
  const row = renderStoryRow(story);
  assert.ok(row.includes('FAIL: typecheck passes not met'));
});

test('renderStoryRow shows failure reason and duration together', () => {
  const story = makeStory({ state: 'fail', failureReason: 'tests failed', duration: '3m 10s' });
  const row = renderStoryRow(story);
  assert.ok(row.includes('FAIL: tests failed'), 'should include reason');
  assert.ok(row.includes('3m 10s'), 'should include duration');
});

test('renderStoryRow shows building... label for building state', () => {
  const story = makeStory({ state: 'building' });
  assert.ok(renderStoryRow(story).includes('building...'));
});

test('renderStoryRow shows validating... label for validating state', () => {
  const story = makeStory({ state: 'validating' });
  assert.ok(renderStoryRow(story).includes('validating...'));
});

// ---------------------------------------------------------------------------
// renderFooter
// ---------------------------------------------------------------------------

test('renderFooter includes quit keybinding', () => {
  const footer = renderFooter();
  assert.ok(footer.includes('quit'), 'footer should include quit');
});

test('renderFooter includes expected keys for dashboard view', () => {
  const footer = renderFooter('dashboard', false);
  assert.ok(footer.includes('[d] logs'));
  assert.ok(footer.includes('[e] epic detail'));
  assert.ok(footer.includes('[q] quit'));
});

// ---------------------------------------------------------------------------
// renderActivityLine
// ---------------------------------------------------------------------------

test('renderActivityLine returns null for completed epic', () => {
  const epic = makeEpic({ status: 'completed', currentActivity: 'editing foo.ts' });
  assert.equal(renderActivityLine(epic), null);
});

test('renderActivityLine returns null for failed epic', () => {
  const epic = makeEpic({ status: 'failed', currentActivity: 'editing foo.ts' });
  assert.equal(renderActivityLine(epic), null);
});

test('renderActivityLine returns null for merge-failed epic', () => {
  const epic = makeEpic({ status: 'merge-failed', currentActivity: 'editing foo.ts' });
  assert.equal(renderActivityLine(epic), null);
});

test('renderActivityLine returns null when currentActivity is "pending"', () => {
  const epic = makeEpic({ status: 'pending', currentActivity: 'pending' });
  assert.equal(renderActivityLine(epic), null);
});

test('renderActivityLine returns null when currentActivity is empty', () => {
  const epic = makeEpic({ status: 'pending', currentActivity: '' });
  assert.equal(renderActivityLine(epic), null);
});

test('renderActivityLine returns activity line for active epic', () => {
  const epic = makeEpic({ status: 'pending', currentActivity: 'editing api.ts' });
  const line = renderActivityLine(epic);
  assert.ok(line !== null, 'should return activity line for pending epic');
  assert.ok(line!.includes('editing api.ts'), `line should include activity: "${line}"`);
  assert.ok(line!.startsWith('    > '), `line should be indented with "> " prefix: "${line}"`);
});

test('renderActivityLine returns activity line for partial epic', () => {
  const epic = makeEpic({ status: 'partial', currentActivity: 'running tests' });
  const line = renderActivityLine(epic);
  assert.ok(line !== null);
  assert.ok(line!.includes('running tests'));
});

test('renderActivityLine includes idle spinner text', () => {
  const epic = makeEpic({ status: 'pending', currentActivity: 'idle -' });
  const line = renderActivityLine(epic);
  assert.ok(line !== null);
  assert.ok(line!.includes('idle'), 'should include idle text');
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

test('renderEpicList includes story rows under each epic when stories present', () => {
  const state = makeState({
    epics: [
      makeEpic({
        id: 'EPIC-001',
        title: 'First',
        stories: [
          makeStory({ id: 'US-001', title: 'Story One', state: 'pass' }),
          makeStory({ id: 'US-002', title: 'Story Two', state: 'fail', failureReason: 'error' }),
        ],
      }),
    ],
  });
  const content = renderEpicList(state);
  assert.ok(content.includes('EPIC-001'), 'should include epic row');
  assert.ok(content.includes('US-001'), 'should include US-001 story row');
  assert.ok(content.includes('US-002'), 'should include US-002 story row');
  assert.ok(content.includes('FAIL: error'), 'should include failure reason');
});

test('renderEpicList story rows appear after epic row', () => {
  const state = makeState({
    epics: [
      makeEpic({
        id: 'EPIC-001',
        stories: [makeStory({ id: 'US-001', state: 'queued' })],
      }),
    ],
  });
  const content = renderEpicList(state);
  const epicIdx = content.indexOf('EPIC-001');
  const storyIdx = content.indexOf('US-001');
  assert.ok(epicIdx < storyIdx, 'epic row should appear before story row');
});

test('renderEpicList shows activity line under active (pending) epic', () => {
  const state = makeState({
    epics: [
      makeEpic({
        id: 'EPIC-001',
        status: 'pending',
        currentActivity: 'editing main.ts',
      }),
    ],
  });
  const content = renderEpicList(state);
  assert.ok(content.includes('editing main.ts'), 'should include activity');
  assert.ok(content.includes('> editing'), 'activity should be prefixed with >');
});

test('renderEpicList does NOT show activity line for completed epic', () => {
  const state = makeState({
    epics: [
      makeEpic({
        id: 'EPIC-001',
        status: 'completed',
        currentActivity: 'editing main.ts',
      }),
    ],
  });
  const content = renderEpicList(state);
  assert.ok(!content.includes('editing main.ts'), 'completed epic should not show activity');
});
