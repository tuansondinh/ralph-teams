/**
 * test/dashboard-summary.test.ts — Tests for the final run summary view.
 *
 * Covers:
 * - computeRunSummary() with all-pass, all-fail, mixed, and empty inputs
 * - renderSummaryView() output contains expected sections
 * - isRunComplete() helper
 * - renderFooter('summary') returns expected string
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRunSummary, renderSummaryView } from '../src/dashboard/views/summary-view';
import { isRunComplete } from '../src/dashboard/poller';
import { renderFooter } from '../src/dashboard/renderer';
import { DashboardState, EpicDisplayData, StoryDisplayData } from '../src/dashboard/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEpic(overrides: Partial<EpicDisplayData> = {}): EpicDisplayData {
  return {
    id: 'EPIC-001',
    title: 'Foundation Epic',
    status: 'pending',
    storiesPassed: 0,
    storiesTotal: 0,
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
    attempts: 0,
    cycles: [],
    ...overrides,
  };
}

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    projectName: 'TestProject',
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isRunComplete
// ---------------------------------------------------------------------------

describe('isRunComplete', () => {
  it('returns false for empty epics array', () => {
    assert.equal(isRunComplete([]), false);
  });

  it('returns true when all epics are completed', () => {
    const epics = [
      makeEpic({ status: 'completed' }),
      makeEpic({ id: 'EPIC-002', status: 'completed' }),
    ];
    assert.equal(isRunComplete(epics), true);
  });

  it('returns true when all epics are failed', () => {
    const epics = [
      makeEpic({ status: 'failed' }),
      makeEpic({ id: 'EPIC-002', status: 'failed' }),
    ];
    assert.equal(isRunComplete(epics), true);
  });

  it('returns true when all epics are partial', () => {
    const epics = [makeEpic({ status: 'partial' })];
    assert.equal(isRunComplete(epics), true);
  });

  it('returns true when all epics are merge-failed', () => {
    const epics = [makeEpic({ status: 'merge-failed' })];
    assert.equal(isRunComplete(epics), true);
  });

  it('returns true for mixed terminal states', () => {
    const epics = [
      makeEpic({ id: 'EPIC-001', status: 'completed' }),
      makeEpic({ id: 'EPIC-002', status: 'failed' }),
      makeEpic({ id: 'EPIC-003', status: 'partial' }),
      makeEpic({ id: 'EPIC-004', status: 'merge-failed' }),
    ];
    assert.equal(isRunComplete(epics), true);
  });

  it('returns false when at least one epic is still pending', () => {
    const epics = [
      makeEpic({ id: 'EPIC-001', status: 'completed' }),
      makeEpic({ id: 'EPIC-002', status: 'pending' }),
    ];
    assert.equal(isRunComplete(epics), false);
  });

  it('returns false when one epic is pending among terminal epics', () => {
    const epics = [
      makeEpic({ id: 'EPIC-001', status: 'completed' }),
      makeEpic({ id: 'EPIC-002', status: 'failed' }),
      makeEpic({ id: 'EPIC-003', status: 'pending' }),
    ];
    assert.equal(isRunComplete(epics), false);
  });
});

// ---------------------------------------------------------------------------
// computeRunSummary — all stories pass
// ---------------------------------------------------------------------------

describe('computeRunSummary — all pass', () => {
  it('counts completed epics and passed stories', () => {
    const stories = [
      makeStory({ id: 'US-001', state: 'pass' }),
      makeStory({ id: 'US-002', state: 'pass' }),
    ];
    const state = makeState({
      epics: [makeEpic({ status: 'completed', stories, storiesPassed: 2, storiesTotal: 2 })],
      totalCostUsd: 0.50,
      totalElapsed: '5m 0s',
    });
    const summary = computeRunSummary(state);

    assert.equal(summary.totalEpics, 1);
    assert.equal(summary.completedEpics, 1);
    assert.equal(summary.failedEpics, 0);
    assert.equal(summary.partialEpics, 0);
    assert.equal(summary.totalStories, 2);
    assert.equal(summary.passedStories, 2);
    assert.equal(summary.failedStories, 0);
    assert.deepEqual(summary.failedStoryDetails, []);
    assert.equal(summary.totalCost, 0.50);
    assert.equal(summary.totalElapsed, '5m 0s');
  });
});

// ---------------------------------------------------------------------------
// computeRunSummary — all stories fail
// ---------------------------------------------------------------------------

describe('computeRunSummary — all fail', () => {
  it('counts failed epics and failed stories with details', () => {
    const stories = [
      makeStory({ id: 'US-001', title: 'Auth story', state: 'fail', failureReason: 'typecheck error' }),
      makeStory({ id: 'US-002', title: 'API story', state: 'fail', failureReason: 'test failed' }),
    ];
    const epic = makeEpic({
      id: 'EPIC-001',
      title: 'Foundation Epic',
      status: 'failed',
      stories,
    });
    const state = makeState({ epics: [epic] });
    const summary = computeRunSummary(state);

    assert.equal(summary.totalEpics, 1);
    assert.equal(summary.completedEpics, 0);
    assert.equal(summary.failedEpics, 1);
    assert.equal(summary.partialEpics, 0);
    assert.equal(summary.totalStories, 2);
    assert.equal(summary.passedStories, 0);
    assert.equal(summary.failedStories, 2);
    assert.equal(summary.failedStoryDetails.length, 2);

    assert.equal(summary.failedStoryDetails[0].storyId, 'US-001');
    assert.equal(summary.failedStoryDetails[0].epicId, 'EPIC-001');
    assert.equal(summary.failedStoryDetails[0].epicTitle, 'Foundation Epic');
    assert.equal(summary.failedStoryDetails[0].failureReason, 'typecheck error');

    assert.equal(summary.failedStoryDetails[1].storyId, 'US-002');
    assert.equal(summary.failedStoryDetails[1].failureReason, 'test failed');
  });
});

// ---------------------------------------------------------------------------
// computeRunSummary — mixed
// ---------------------------------------------------------------------------

describe('computeRunSummary — mixed', () => {
  it('handles mixed pass/fail stories across multiple epics', () => {
    const epic1 = makeEpic({
      id: 'EPIC-001',
      title: 'Epic One',
      status: 'completed',
      stories: [
        makeStory({ id: 'US-001', state: 'pass' }),
        makeStory({ id: 'US-002', state: 'fail', failureReason: 'timeout' }),
      ],
    });
    const epic2 = makeEpic({
      id: 'EPIC-002',
      title: 'Epic Two',
      status: 'partial',
      stories: [
        makeStory({ id: 'US-003', state: 'pass' }),
        makeStory({ id: 'US-004', state: 'pass' }),
      ],
    });
    const state = makeState({
      epics: [epic1, epic2],
      totalCostUsd: 1.25,
      totalElapsed: '10m 0s',
    });
    const summary = computeRunSummary(state);

    assert.equal(summary.totalEpics, 2);
    assert.equal(summary.completedEpics, 1);
    assert.equal(summary.failedEpics, 0);
    assert.equal(summary.partialEpics, 1);
    assert.equal(summary.totalStories, 4);
    assert.equal(summary.passedStories, 3);
    assert.equal(summary.failedStories, 1);
    assert.equal(summary.failedStoryDetails.length, 1);
    assert.equal(summary.failedStoryDetails[0].storyId, 'US-002');
    assert.equal(summary.failedStoryDetails[0].epicId, 'EPIC-001');
  });

  it('counts merge-failed epics in failedEpics', () => {
    const state = makeState({
      epics: [makeEpic({ status: 'merge-failed' })],
    });
    const summary = computeRunSummary(state);
    assert.equal(summary.failedEpics, 1);
  });
});

// ---------------------------------------------------------------------------
// computeRunSummary — no epics
// ---------------------------------------------------------------------------

describe('computeRunSummary — no epics', () => {
  it('returns all-zero summary for empty state', () => {
    const state = makeState({ epics: [] });
    const summary = computeRunSummary(state);

    assert.equal(summary.totalEpics, 0);
    assert.equal(summary.completedEpics, 0);
    assert.equal(summary.failedEpics, 0);
    assert.equal(summary.partialEpics, 0);
    assert.equal(summary.totalStories, 0);
    assert.equal(summary.passedStories, 0);
    assert.equal(summary.failedStories, 0);
    assert.deepEqual(summary.failedStoryDetails, []);
    assert.equal(summary.totalCost, null);
  });
});

// ---------------------------------------------------------------------------
// renderSummaryView — output sections
// ---------------------------------------------------------------------------

describe('renderSummaryView', () => {
  it('contains the run complete header', () => {
    const summary = computeRunSummary(makeState());
    const output = renderSummaryView(summary);
    assert.ok(output.includes('Run Complete'), 'should include "Run Complete"');
    assert.ok(output.includes('[q] quit') || output.includes('press q to quit'), 'should mention quitting');
  });

  it('contains "Run Summary" section title', () => {
    const summary = computeRunSummary(makeState());
    const output = renderSummaryView(summary);
    assert.ok(output.includes('Run Summary'));
  });

  it('shows epic counts', () => {
    const state = makeState({
      epics: [
        makeEpic({ id: 'EPIC-001', status: 'completed' }),
        makeEpic({ id: 'EPIC-002', status: 'failed' }),
      ],
    });
    const summary = computeRunSummary(state);
    const output = renderSummaryView(summary);
    assert.ok(output.includes('2 total'), 'should show total epic count');
    assert.ok(output.includes('1 completed'), 'should show completed count');
    assert.ok(output.includes('1 failed'), 'should show failed count');
  });

  it('shows story pass/fail counts', () => {
    const stories = [
      makeStory({ id: 'US-001', state: 'pass' }),
      makeStory({ id: 'US-002', state: 'fail', failureReason: 'oops' }),
    ];
    const state = makeState({
      epics: [makeEpic({ status: 'partial', stories })],
    });
    const summary = computeRunSummary(state);
    const output = renderSummaryView(summary);
    assert.ok(output.includes('1 passed'), 'should show passed story count');
    assert.ok(output.includes('1 failed'), 'should show failed story count');
  });

  it('shows total cost', () => {
    const state = makeState({ totalCostUsd: 2.34 });
    const summary = computeRunSummary(state);
    const output = renderSummaryView(summary);
    assert.ok(output.includes('$2.34'), 'should show total cost');
  });

  it('shows -- cost when totalCost is null', () => {
    const state = makeState({ totalCostUsd: null });
    const summary = computeRunSummary(state);
    const output = renderSummaryView(summary);
    assert.ok(output.includes('--'), 'should show -- for unknown cost');
  });

  it('shows total elapsed time', () => {
    const state = makeState({ totalElapsed: '15m 30s' });
    const summary = computeRunSummary(state);
    const output = renderSummaryView(summary);
    assert.ok(output.includes('15m 30s'), 'should show elapsed time');
  });

  it('shows "(none)" when no stories failed', () => {
    const stories = [makeStory({ id: 'US-001', state: 'pass' })];
    const state = makeState({
      epics: [makeEpic({ status: 'completed', stories })],
    });
    const summary = computeRunSummary(state);
    const output = renderSummaryView(summary);
    assert.ok(output.includes('(none)'), 'should show (none) for failed stories section');
  });

  it('shows failed story details with epic context', () => {
    const stories = [
      makeStory({ id: 'US-002', title: 'My Failed Story', state: 'fail', failureReason: 'typecheck error' }),
    ];
    const state = makeState({
      epics: [makeEpic({ id: 'EPIC-001', title: 'Foundation Epic', status: 'partial', stories })],
    });
    const summary = computeRunSummary(state);
    const output = renderSummaryView(summary);
    assert.ok(output.includes('US-002'), 'should show failed story ID');
    assert.ok(output.includes('My Failed Story'), 'should show failed story title');
    assert.ok(output.includes('EPIC-001'), 'should show epic context');
    assert.ok(output.includes('Foundation Epic'), 'should show epic title');
    assert.ok(output.includes('typecheck error'), 'should show failure reason');
  });

  it('shows "Failed Stories:" section header', () => {
    const summary = computeRunSummary(makeState());
    const output = renderSummaryView(summary);
    assert.ok(output.includes('Failed Stories:'), 'should have Failed Stories section');
  });

  it('uses a separator line in the output', () => {
    const summary = computeRunSummary(makeState());
    const output = renderSummaryView(summary);
    assert.ok(output.includes('─'), 'should include separator line');
  });
});

// ---------------------------------------------------------------------------
// renderFooter — summary mode (no failed stories / all passed)
// ---------------------------------------------------------------------------

describe('renderFooter for summary view — all stories passed', () => {
  it('shows "All stories passed!" when hasFailedStories is false', () => {
    const footer = renderFooter('summary', false, false);
    assert.ok(footer.includes('All stories passed!'), 'should show all-passed message');
  });

  it('shows "[q] quit" when all stories passed', () => {
    const footer = renderFooter('summary', false, false);
    assert.ok(footer.includes('[q] quit'), 'should include [q] quit');
  });

  it('does not show discuss or retry hints when no failures', () => {
    const footer = renderFooter('summary', false, false);
    assert.ok(!footer.includes('[d] discuss'), 'should not include discuss hint');
    assert.ok(!footer.includes('[r] retry'), 'should not include retry hint');
  });

  it('defaults hasFailedStories to false (backward-compatible)', () => {
    // Calling with 2 args: should behave as all-passed
    const footer = renderFooter('summary', false);
    assert.ok(footer.includes('All stories passed!'), 'default should be all-passed footer');
  });
});

// ---------------------------------------------------------------------------
// renderFooter — summary mode (with failed stories — interactive menu)
// ---------------------------------------------------------------------------

describe('renderFooter for summary view — with failed stories', () => {
  it('shows [d] discuss when there are failed stories', () => {
    const footer = renderFooter('summary', false, true);
    assert.ok(footer.includes('[d] discuss a story'), 'should include discuss hint');
  });

  it('shows [r] retry when there are failed stories', () => {
    const footer = renderFooter('summary', false, true);
    assert.ok(footer.includes('[r] retry all failed'), 'should include retry hint');
  });

  it('shows [q] quit when there are failed stories', () => {
    const footer = renderFooter('summary', false, true);
    assert.ok(footer.includes('[q] quit'), 'should include quit hint');
  });

  it('does not show "All stories passed!" when there are failures', () => {
    const footer = renderFooter('summary', false, true);
    assert.ok(!footer.includes('All stories passed!'), 'should not show all-passed message');
  });

  it('does not include dashboard-mode hints', () => {
    const footer = renderFooter('summary', false, true);
    assert.ok(!footer.includes('[d] logs'), 'should not include logs toggle hint');
    assert.ok(!footer.includes('[e] epic detail'), 'should not include epic detail hint');
  });
});

// ---------------------------------------------------------------------------
// renderFooter — awaitingEpicNumber overrides
// ---------------------------------------------------------------------------

describe('renderFooter awaitingEpicNumber override for summary', () => {
  it('awaitingEpicNumber overrides summary/no-failures footer', () => {
    const footer = renderFooter('summary', true, false);
    assert.ok(footer.includes('1-9'), 'awaiting number prompt should override all-passed footer');
  });

  it('awaitingEpicNumber overrides summary/with-failures footer', () => {
    const footer = renderFooter('summary', true, true);
    assert.ok(footer.includes('1-9'), 'awaiting number prompt should override menu footer');
  });
});

// ---------------------------------------------------------------------------
// renderFooter — discuss mode
// ---------------------------------------------------------------------------

describe('renderFooter for discuss view', () => {
  it('shows guidance instructions in discuss mode', () => {
    const footer = renderFooter('discuss', false);
    assert.ok(footer.includes('Enter') || footer.includes('send'), 'discuss footer should show input instructions');
  });

  it('mentions how to finish in discuss mode (done or Esc)', () => {
    const footer = renderFooter('discuss', false);
    assert.ok(footer.includes('done') || footer.includes('Esc'), 'discuss footer should mention how to finish');
  });

  it('does not show dashboard hints in discuss mode', () => {
    const footer = renderFooter('discuss', false);
    assert.ok(!footer.includes('[d] logs'), 'discuss footer should not include logs toggle');
  });
});
