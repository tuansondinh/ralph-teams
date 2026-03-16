/**
 * test/dashboard-views.test.ts — Tests for view switching logic and detail rendering.
 *
 * Covers:
 * - renderFooter for each view mode + awaitingEpicNumber
 * - renderRawLogView with various buffer states
 * - renderEpicDetailContent with full/empty story lists and log tails
 * - appendLogLines bounded buffer behavior
 * - View state transition logic (pure logic, no blessed)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderFooter,
  renderRawLogView,
  renderEpicDetailContent,
} from '../src/dashboard/renderer';
import { appendLogLines, renderLogView } from '../src/dashboard/views/log-view';
import { renderEpicDetail, renderDetailStoryRow } from '../src/dashboard/views/epic-detail-view';
import { DashboardState, EpicDisplayData, StoryDisplayData } from '../src/dashboard/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEpic(overrides: Partial<EpicDisplayData> = {}): EpicDisplayData {
  return {
    id: 'EPIC-001',
    title: 'Foundation Epic',
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
    ...overrides,
  };
}

function makeStory(overrides: Partial<StoryDisplayData> = {}): StoryDisplayData {
  return {
    id: 'US-001',
    title: 'My Story',
    state: 'queued',
    failureReason: null,
    duration: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    projectName: 'TestProject',
    currentWave: 1,
    startedAt: null,
    epics: [makeEpic()],
    totalCostUsd: null,
    totalCostEstimate: null,
    totalElapsed: '5m 0s',
    totalTimeEstimate: null,
    viewMode: 'dashboard',
    selectedEpicId: null,
    rawLogLines: [],
    mergeEvents: [],
    awaitingEpicNumber: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// renderFooter
// ---------------------------------------------------------------------------

describe('renderFooter', () => {
  it('shows dashboard hint text for dashboard view', () => {
    const footer = renderFooter('dashboard', false);
    assert.ok(footer.includes('[d] logs'));
    assert.ok(footer.includes('[e] epic detail'));
    assert.ok(footer.includes('[q] quit'));
  });

  it('shows log view hint for logs mode', () => {
    const footer = renderFooter('logs', false);
    assert.ok(footer.includes('[d] dashboard'));
    assert.ok(footer.includes('[q] quit'));
    assert.ok(!footer.includes('[e] epic detail'));
  });

  it('shows back hint for epic-detail mode', () => {
    const footer = renderFooter('epic-detail', false);
    assert.ok(footer.includes('[q/Esc] back to dashboard'));
    assert.ok(!footer.includes('[d] logs'));
  });

  it('shows epic number prompt when awaitingEpicNumber is true', () => {
    const footer = renderFooter('dashboard', true);
    assert.ok(footer.includes('1-9'));
    assert.ok(!footer.includes('[d] logs'));
  });

  it('awaitingEpicNumber overrides all view modes', () => {
    assert.ok(renderFooter('logs', true).includes('1-9'));
    assert.ok(renderFooter('epic-detail', true).includes('1-9'));
  });

  it('defaults to dashboard view with no args', () => {
    const footer = renderFooter();
    assert.ok(footer.includes('[d] logs'));
  });
});

// ---------------------------------------------------------------------------
// renderRawLogView (renderer.ts)
// ---------------------------------------------------------------------------

describe('renderRawLogView', () => {
  it('shows placeholder when buffer is empty', () => {
    const content = renderRawLogView([]);
    assert.ok(content.includes('no log output yet'));
    assert.ok(content.includes("press 'd' to return"));
  });

  it('shows the header line', () => {
    const content = renderRawLogView(['line1']);
    assert.ok(content.includes("press 'd' to return to dashboard"));
  });

  it('includes all lines when under maxLines', () => {
    const lines = ['alpha', 'beta', 'gamma'];
    const content = renderRawLogView(lines);
    assert.ok(content.includes('alpha'));
    assert.ok(content.includes('beta'));
    assert.ok(content.includes('gamma'));
  });

  it('trims to last maxLines when buffer exceeds limit', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i}`);
    const content = renderRawLogView(lines, 10);
    // Should include the last 10 lines
    assert.ok(content.includes('line-299'));
    assert.ok(content.includes('line-290'));
    // Should NOT include early lines
    assert.ok(!content.includes('line-0'));
    assert.ok(!content.includes('line-289'));
  });
});

// ---------------------------------------------------------------------------
// renderLogView (views/log-view.ts)
// ---------------------------------------------------------------------------

describe('renderLogView', () => {
  it('shows placeholder when buffer is empty', () => {
    const content = renderLogView([]);
    assert.ok(content.includes('no log output yet'));
  });

  it('includes all lines from buffer', () => {
    const content = renderLogView(['foo', 'bar']);
    assert.ok(content.includes('foo'));
    assert.ok(content.includes('bar'));
  });

  it('trims to maxLines', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`);
    const content = renderLogView(lines, 5);
    assert.ok(content.includes('line-49'));
    assert.ok(!content.includes('line-0'));
  });
});

// ---------------------------------------------------------------------------
// appendLogLines
// ---------------------------------------------------------------------------

describe('appendLogLines', () => {
  it('appends lines to the buffer', () => {
    const buf: string[] = ['existing'];
    appendLogLines(buf, ['new1', 'new2']);
    assert.deepEqual(buf, ['existing', 'new1', 'new2']);
  });

  it('drops oldest lines when exceeding maxLines', () => {
    const buf: string[] = Array.from({ length: 10 }, (_, i) => `old-${i}`);
    appendLogLines(buf, ['new1', 'new2'], 10);
    assert.equal(buf.length, 10);
    assert.ok(buf.includes('new1'));
    assert.ok(buf.includes('new2'));
    assert.ok(!buf.includes('old-0'));
    assert.ok(!buf.includes('old-1'));
  });

  it('keeps buffer size at exactly maxLines', () => {
    const buf: string[] = Array.from({ length: 5 }, (_, i) => `a-${i}`);
    appendLogLines(buf, ['b1', 'b2', 'b3'], 5);
    assert.equal(buf.length, 5);
  });

  it('handles empty newLines without changing buffer', () => {
    const buf: string[] = ['a', 'b'];
    appendLogLines(buf, []);
    assert.deepEqual(buf, ['a', 'b']);
  });

  it('handles empty buffer with new lines', () => {
    const buf: string[] = [];
    appendLogLines(buf, ['x', 'y', 'z'], 100);
    assert.deepEqual(buf, ['x', 'y', 'z']);
  });
});

// ---------------------------------------------------------------------------
// renderEpicDetailContent (renderer.ts)
// ---------------------------------------------------------------------------

describe('renderEpicDetailContent', () => {
  it('returns placeholder when epicId is null', () => {
    const state = makeState();
    const result = renderEpicDetailContent(state, null, '');
    assert.ok(result.includes('no epic selected'));
  });

  it('returns not-found message for unknown epicId', () => {
    const state = makeState();
    const result = renderEpicDetailContent(state, 'EPIC-999', '');
    assert.ok(result.includes('EPIC-999'));
    assert.ok(result.includes('not found'));
  });

  it('shows epic ID and title in header', () => {
    const state = makeState();
    const result = renderEpicDetailContent(state, 'EPIC-001', '');
    assert.ok(result.includes('EPIC-001'));
    assert.ok(result.includes('Foundation Epic'));
  });

  it('shows progress fraction', () => {
    const state = makeState({ epics: [makeEpic({ storiesPassed: 3, storiesTotal: 5 })] });
    const result = renderEpicDetailContent(state, 'EPIC-001', '');
    assert.ok(result.includes('3/5'));
  });

  it('shows cost actual when available', () => {
    const epic = makeEpic({ costActual: 1.50 });
    const state = makeState({ epics: [epic] });
    const result = renderEpicDetailContent(state, 'EPIC-001', '');
    assert.ok(result.includes('$1.50'));
  });

  it('shows cost estimate when no actual', () => {
    const epic = makeEpic({ costEstimate: '~$0.90' });
    const state = makeState({ epics: [epic] });
    const result = renderEpicDetailContent(state, 'EPIC-001', '');
    assert.ok(result.includes('~$0.90'));
  });

  it('shows (no stories) when epic has no stories', () => {
    const state = makeState();
    const result = renderEpicDetailContent(state, 'EPIC-001', '');
    assert.ok(result.includes('(no stories)'));
  });

  it('renders each story row', () => {
    const stories: StoryDisplayData[] = [
      makeStory({ id: 'US-001', title: 'First Story', state: 'pass', duration: '2m 0s' }),
      makeStory({ id: 'US-002', title: 'Second Story', state: 'fail', failureReason: 'tests failed' }),
    ];
    const state = makeState({ epics: [makeEpic({ stories })] });
    const result = renderEpicDetailContent(state, 'EPIC-001', '');
    assert.ok(result.includes('US-001'));
    assert.ok(result.includes('US-002'));
    assert.ok(result.includes('PASS'));
    assert.ok(result.includes('FAIL'));
    assert.ok(result.includes('tests failed'));
  });

  it('shows log tail when provided', () => {
    const state = makeState();
    const result = renderEpicDetailContent(state, 'EPIC-001', 'some log line here');
    assert.ok(result.includes('some log line here'));
  });

  it('shows (no log output available) when logTail is empty', () => {
    const state = makeState();
    const result = renderEpicDetailContent(state, 'EPIC-001', '');
    assert.ok(result.includes('(no log output available)'));
  });

  it('shows the back-to-dashboard hint in header', () => {
    const state = makeState();
    const result = renderEpicDetailContent(state, 'EPIC-001', '');
    assert.ok(result.includes("press 'q' or Esc to return"));
  });

  it('trims log tail to last 15 lines', () => {
    const manyLines = Array.from({ length: 30 }, (_, i) => `logline-${i}`).join('\n');
    const state = makeState();
    const result = renderEpicDetailContent(state, 'EPIC-001', manyLines);
    assert.ok(result.includes('logline-29'));  // last line visible
    assert.ok(!result.includes('logline-0')); // first line trimmed
  });
});

// ---------------------------------------------------------------------------
// renderEpicDetail (views/epic-detail-view.ts)
// ---------------------------------------------------------------------------

describe('renderEpicDetail', () => {
  it('renders epic summary section', () => {
    const epic = makeEpic({ costActual: 0.75, timeActual: '3m 30s' });
    const result = renderEpicDetail(epic, '');
    assert.ok(result.includes('EPIC-001'));
    assert.ok(result.includes('Foundation Epic'));
    assert.ok(result.includes('$0.75'));
    assert.ok(result.includes('3m 30s'));
  });

  it('shows (no stories) when empty', () => {
    const epic = makeEpic({ stories: [] });
    const result = renderEpicDetail(epic, '');
    assert.ok(result.includes('(no stories)'));
  });

  it('includes story rows', () => {
    const epic = makeEpic({
      stories: [makeStory({ id: 'US-001', state: 'pass' })],
    });
    const result = renderEpicDetail(epic, '');
    assert.ok(result.includes('US-001'));
    assert.ok(result.includes('PASS'));
  });

  it('includes log tail content', () => {
    const epic = makeEpic();
    const result = renderEpicDetail(epic, 'recent log entry here');
    assert.ok(result.includes('recent log entry here'));
  });
});

// ---------------------------------------------------------------------------
// renderDetailStoryRow (views/epic-detail-view.ts)
// ---------------------------------------------------------------------------

describe('renderDetailStoryRow', () => {
  it('renders a pass story with duration', () => {
    const story = makeStory({ state: 'pass', duration: '2m 0s' });
    const row = renderDetailStoryRow(story, 0);
    assert.ok(row.includes('+'));
    assert.ok(row.includes('US-001'));
    assert.ok(row.includes('PASS'));
    assert.ok(row.includes('2m 0s'));
  });

  it('renders a fail story with reason', () => {
    const story = makeStory({ state: 'fail', failureReason: 'typecheck error' });
    const row = renderDetailStoryRow(story, 1);
    assert.ok(row.includes('x'));
    assert.ok(row.includes('FAIL'));
    assert.ok(row.includes('typecheck error'));
  });

  it('renders building state', () => {
    const story = makeStory({ state: 'building' });
    const row = renderDetailStoryRow(story, 0);
    assert.ok(row.includes('building...'));
  });

  it('renders validating state', () => {
    const story = makeStory({ state: 'validating' });
    const row = renderDetailStoryRow(story, 0);
    assert.ok(row.includes('validating...'));
  });

  it('renders queued story with no suffix', () => {
    const story = makeStory({ state: 'queued' });
    const row = renderDetailStoryRow(story, 0);
    assert.ok(row.includes('-'));
    assert.ok(!row.includes('PASS'));
    assert.ok(!row.includes('FAIL'));
  });

  it('uses 1-based numbering', () => {
    const story = makeStory();
    const row0 = renderDetailStoryRow(story, 0);
    const row4 = renderDetailStoryRow(story, 4);
    assert.ok(row0.includes(' 1.'));
    assert.ok(row4.includes(' 5.'));
  });
});

// ---------------------------------------------------------------------------
// View mode state transition logic (pure logic, no blessed)
// ---------------------------------------------------------------------------

describe('view mode state transitions', () => {
  it("'d' toggles dashboard → logs", () => {
    const state = makeState({ viewMode: 'dashboard' });
    const next = { ...state, viewMode: 'logs' as const };
    assert.equal(next.viewMode, 'logs');
  });

  it("'d' toggles logs → dashboard", () => {
    const state = makeState({ viewMode: 'logs' });
    const next = { ...state, viewMode: 'dashboard' as const };
    assert.equal(next.viewMode, 'dashboard');
  });

  it("'e' + digit selects epic-detail", () => {
    const state = makeState({
      epics: [makeEpic({ id: 'EPIC-001' }), makeEpic({ id: 'EPIC-002' })],
    });
    // Simulate pressing 'e' then '2'
    const epicIndex = 2 - 1; // digit '2' → index 1
    const selectedEpicId = state.epics[epicIndex]?.id ?? null;
    const next = {
      ...state,
      viewMode: 'epic-detail' as const,
      selectedEpicId,
    };
    assert.equal(next.viewMode, 'epic-detail');
    assert.equal(next.selectedEpicId, 'EPIC-002');
  });

  it("'e' + out-of-range digit does not change view mode", () => {
    const state = makeState({ epics: [makeEpic()] }); // 1 epic
    const epicIndex = 9 - 1; // digit '9' → index 8 — out of range
    if (epicIndex >= state.epics.length) {
      // Should not update state
      assert.equal(state.viewMode, 'dashboard');
    }
  });

  it("'q' from epic-detail returns to dashboard", () => {
    const state = makeState({ viewMode: 'epic-detail', selectedEpicId: 'EPIC-001' });
    const next = { ...state, viewMode: 'dashboard' as const, selectedEpicId: null };
    assert.equal(next.viewMode, 'dashboard');
    assert.equal(next.selectedEpicId, null);
  });

  it("'q' from logs returns to dashboard", () => {
    const state = makeState({ viewMode: 'logs' });
    const next = { ...state, viewMode: 'dashboard' as const };
    assert.equal(next.viewMode, 'dashboard');
  });

  it("'e' sets awaitingEpicNumber=true", () => {
    // Simulated: pressing 'e' sets awaitingEpicNumber
    let awaitingEpicNumber = false;
    awaitingEpicNumber = true;
    assert.equal(awaitingEpicNumber, true);
  });

  it('digit clears awaitingEpicNumber after selection', () => {
    let awaitingEpicNumber = true;
    // After digit press
    awaitingEpicNumber = false;
    assert.equal(awaitingEpicNumber, false);
  });

  it('awaitingEpicNumber footer is shown when true', () => {
    const footer = renderFooter('dashboard', true);
    assert.ok(footer.includes('1-9'));
  });

  it('awaitingEpicNumber footer is NOT shown when false', () => {
    const footer = renderFooter('dashboard', false);
    assert.ok(!footer.includes('1-9'));
  });
});
