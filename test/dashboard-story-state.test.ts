/**
 * test/dashboard-story-state.test.ts — Tests for story state determination logic.
 *
 * Tests all five states (queued, building, validating, pass, fail), failure
 * reason extraction, and edge cases.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  determineStoryState,
  extractFailureReason,
  hasFailSignalInProgress,
  hasValidatingSignalInProgress,
  hasBuildingSignalInProgress,
  filterProgressLinesForStory,
  parseCyclesFromProgress,
  StoryStateInput,
} from '../src/dashboard/story-state-parser';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<StoryStateInput> = {}): StoryStateInput {
  return {
    storyId: 'US-001',
    epicId: 'EPIC-001',
    passes: false,
    hasStatsEntry: false,
    statsCompleted: false,
    statsPassed: false,
    statsDuration: null,
    progressLines: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractFailureReason
// ---------------------------------------------------------------------------

test('extractFailureReason returns null when no FAIL: pattern present', () => {
  assert.equal(extractFailureReason('some random line'), null);
  assert.equal(extractFailureReason(''), null);
  assert.equal(extractFailureReason('FAILED — date'), null);
});

test('extractFailureReason returns text after FAIL: prefix', () => {
  assert.equal(
    extractFailureReason('US-003 FAIL: typecheck passes not met'),
    'typecheck passes not met',
  );
});

test('extractFailureReason is case-insensitive', () => {
  assert.equal(extractFailureReason('fail: tests failed'), 'tests failed');
  assert.equal(extractFailureReason('Fail: bad output'), 'bad output');
});

test('extractFailureReason strips leading whitespace after FAIL:', () => {
  assert.equal(extractFailureReason('FAIL:   trimmed reason'), 'trimmed reason');
});

test('extractFailureReason returns null when nothing follows FAIL:', () => {
  assert.equal(extractFailureReason('FAIL:'), null);
  assert.equal(extractFailureReason('FAIL:   '), null);
});

test('extractFailureReason handles reason with special characters', () => {
  assert.equal(
    extractFailureReason('FAIL: 0/5 stories passed — see logs'),
    '0/5 stories passed — see logs',
  );
});

// ---------------------------------------------------------------------------
// hasFailSignalInProgress
// ---------------------------------------------------------------------------

test('hasFailSignalInProgress returns false for empty array', () => {
  assert.equal(hasFailSignalInProgress([]), false);
});

test('hasFailSignalInProgress returns false when no FAIL lines', () => {
  assert.equal(hasFailSignalInProgress(['success', 'building', 'pass']), false);
});

test('hasFailSignalInProgress returns true when FAIL appears in a line', () => {
  assert.equal(hasFailSignalInProgress(['US-003 FAIL: reason']), true);
  assert.equal(hasFailSignalInProgress(['other line', '[EPIC-001] FAILED — date']), true);
});

test('hasFailSignalInProgress is case-insensitive', () => {
  assert.equal(hasFailSignalInProgress(['fail: something']), true);
});

// ---------------------------------------------------------------------------
// hasValidatingSignalInProgress
// ---------------------------------------------------------------------------

test('hasValidatingSignalInProgress returns false for empty array', () => {
  assert.equal(hasValidatingSignalInProgress([]), false);
});

test('hasValidatingSignalInProgress returns true for "validating" keyword', () => {
  assert.equal(hasValidatingSignalInProgress(['US-001 validating...']), true);
  assert.equal(hasValidatingSignalInProgress(['US-001 validation started']), true);
  assert.equal(hasValidatingSignalInProgress(['validated result']), true);
});

test('hasValidatingSignalInProgress is case-insensitive', () => {
  assert.equal(hasValidatingSignalInProgress(['Validating story']), true);
});

// ---------------------------------------------------------------------------
// hasBuildingSignalInProgress
// ---------------------------------------------------------------------------

test('hasBuildingSignalInProgress returns false for empty array', () => {
  assert.equal(hasBuildingSignalInProgress([]), false);
});

test('hasBuildingSignalInProgress returns true for "building" keyword', () => {
  assert.equal(hasBuildingSignalInProgress(['US-001 building...']), true);
});

test('hasBuildingSignalInProgress returns true for "implementing" keyword', () => {
  assert.equal(hasBuildingSignalInProgress(['implementing story US-001']), true);
});

test('hasBuildingSignalInProgress returns true for "starting" keyword', () => {
  assert.equal(hasBuildingSignalInProgress(['starting story US-001']), true);
});

// ---------------------------------------------------------------------------
// filterProgressLinesForStory
// ---------------------------------------------------------------------------

test('filterProgressLinesForStory returns empty array for empty content', () => {
  assert.deepEqual(filterProgressLinesForStory('', 'US-001', 'EPIC-001'), []);
});

test('filterProgressLinesForStory returns lines containing storyId', () => {
  const content = 'some line\nUS-001 FAIL: reason\nanother line\nUS-001 building';
  const result = filterProgressLinesForStory(content, 'US-001', 'EPIC-001');
  assert.deepEqual(result, ['US-001 FAIL: reason', 'US-001 building']);
});

test('filterProgressLinesForStory returns lines containing [epicId]', () => {
  const content = '[EPIC-001] PASSED — date\n[EPIC-002] FAILED — date';
  const result = filterProgressLinesForStory(content, 'US-001', 'EPIC-001');
  assert.deepEqual(result, ['[EPIC-001] PASSED — date']);
});

test('filterProgressLinesForStory returns both story and epic lines', () => {
  const content = '[EPIC-001] PASSED\nUS-001 building\nUS-002 fail: reason';
  const result = filterProgressLinesForStory(content, 'US-001', 'EPIC-001');
  assert.deepEqual(result, ['[EPIC-001] PASSED', 'US-001 building']);
});

// ---------------------------------------------------------------------------
// determineStoryState — queued state
// ---------------------------------------------------------------------------

test('determineStoryState returns queued when no signals present', () => {
  const result = determineStoryState(makeInput());
  assert.equal(result.state, 'queued');
  assert.equal(result.failureReason, null);
  assert.equal(result.duration, null);
});

test('determineStoryState returns queued when passes=false, no stats, no progress', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: false,
    progressLines: [],
  }));
  assert.equal(result.state, 'queued');
});

// ---------------------------------------------------------------------------
// determineStoryState — pass state
// ---------------------------------------------------------------------------

test('determineStoryState returns pass when passes=true in prd.json', () => {
  const result = determineStoryState(makeInput({ passes: true }));
  assert.equal(result.state, 'pass');
  assert.equal(result.failureReason, null);
});

test('determineStoryState returns pass with duration from stats when passes=true', () => {
  const result = determineStoryState(makeInput({
    passes: true,
    hasStatsEntry: true,
    statsCompleted: true,
    statsPassed: true,
    statsDuration: '2m 12s',
  }));
  assert.equal(result.state, 'pass');
  assert.equal(result.duration, '2m 12s');
});

test('determineStoryState returns pass even without stats when passes=true', () => {
  const result = determineStoryState(makeInput({
    passes: true,
    hasStatsEntry: false,
  }));
  assert.equal(result.state, 'pass');
});

// ---------------------------------------------------------------------------
// determineStoryState — fail state from stats
// ---------------------------------------------------------------------------

test('determineStoryState returns fail when statsCompleted=true and statsPassed=false', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: true,
    statsCompleted: true,
    statsPassed: false,
  }));
  assert.equal(result.state, 'fail');
});

test('determineStoryState returns fail with duration from stats', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: true,
    statsCompleted: true,
    statsPassed: false,
    statsDuration: '3m 10s',
  }));
  assert.equal(result.state, 'fail');
  assert.equal(result.duration, '3m 10s');
});

test('determineStoryState extracts failure reason from progress lines when stats says fail', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: true,
    statsCompleted: true,
    statsPassed: false,
    progressLines: ['US-001 FAIL: typecheck passes not met'],
  }));
  assert.equal(result.state, 'fail');
  assert.equal(result.failureReason, 'typecheck passes not met');
});

test('determineStoryState returns null failureReason when no FAIL: in progress', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: true,
    statsCompleted: true,
    statsPassed: false,
    progressLines: ['[EPIC-001] FAILED — date'],
  }));
  assert.equal(result.state, 'fail');
  assert.equal(result.failureReason, null);
});

// ---------------------------------------------------------------------------
// determineStoryState — fail state from progress lines
// ---------------------------------------------------------------------------

test('determineStoryState returns fail from progress lines when stats not yet written', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: false,
    statsCompleted: false,
    progressLines: ['US-001 FAIL: 0/2 acceptance criteria met'],
  }));
  assert.equal(result.state, 'fail');
  assert.equal(result.failureReason, '0/2 acceptance criteria met');
});

test('determineStoryState extracts first failure reason from multiple progress lines', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    progressLines: [
      'US-001 building',
      'US-001 FAIL: first error',
      'US-001 FAIL: second error',
    ],
  }));
  assert.equal(result.state, 'fail');
  assert.equal(result.failureReason, 'first error');
});

// ---------------------------------------------------------------------------
// determineStoryState — building state
// ---------------------------------------------------------------------------

test('determineStoryState returns building when stats entry exists but not completed', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: true,
    statsCompleted: false,
    statsPassed: false,
  }));
  assert.equal(result.state, 'building');
});

test('determineStoryState returns building from progress signals without stats', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: false,
    progressLines: ['US-001 building...'],
  }));
  assert.equal(result.state, 'building');
});

// ---------------------------------------------------------------------------
// determineStoryState — validating state
// ---------------------------------------------------------------------------

test('determineStoryState returns validating when stats entry exists and validating signal present', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: true,
    statsCompleted: false,
    progressLines: ['US-001 validating...'],
  }));
  assert.equal(result.state, 'validating');
});

test('determineStoryState prefers validating over building when both signals present', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: true,
    statsCompleted: false,
    progressLines: ['US-001 building...', 'US-001 validating...'],
  }));
  assert.equal(result.state, 'validating');
});

// ---------------------------------------------------------------------------
// determineStoryState — priority ordering
// ---------------------------------------------------------------------------

test('determineStoryState: pass takes priority over all other signals', () => {
  // Even if there are fail signals in progress, passes=true wins
  const result = determineStoryState(makeInput({
    passes: true,
    hasStatsEntry: true,
    statsCompleted: true,
    statsPassed: false,
    progressLines: ['US-001 FAIL: something went wrong'],
  }));
  assert.equal(result.state, 'pass');
});

test('determineStoryState: stats-completed fail takes priority over building signal', () => {
  const result = determineStoryState(makeInput({
    passes: false,
    hasStatsEntry: true,
    statsCompleted: true,
    statsPassed: false,
    progressLines: ['US-001 building'],
  }));
  assert.equal(result.state, 'fail');
});

// ---------------------------------------------------------------------------
// Integration: parseEpicsFromPrd with story states
// ---------------------------------------------------------------------------

import { parseEpicsFromPrd } from '../src/dashboard/poller';

const FIXTURE_PRD = JSON.stringify({
  project: 'Test',
  epics: [
    {
      id: 'EPIC-001',
      title: 'First',
      status: 'partial',
      userStories: [
        { id: 'US-001', title: 'Passed story', passes: true },
        { id: 'US-002', title: 'Failed story', passes: false },
        { id: 'US-003', title: 'Queued story', passes: false },
      ],
    },
  ],
});

const FIXTURE_STATS_EPICS = [
  {
    epicId: 'EPIC-001',
    stories: [
      {
        storyId: 'US-001',
        epicId: 'EPIC-001',
        inputTokens: null,
        outputTokens: null,
        cacheCreationInputTokens: null,
        cacheReadInputTokens: null,
        costUsd: 0.05,
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:02:00Z',
        durationMs: 120000,
        durationFormatted: '2m 0s',
        passed: true,
      },
      {
        storyId: 'US-002',
        epicId: 'EPIC-001',
        inputTokens: null,
        outputTokens: null,
        cacheCreationInputTokens: null,
        cacheReadInputTokens: null,
        costUsd: 0.03,
        startedAt: '2024-01-01T00:02:00Z',
        completedAt: '2024-01-01T00:05:10Z',
        durationMs: 190000,
        durationFormatted: '3m 10s',
        passed: false,
      },
    ],
    totalInputTokens: null,
    totalOutputTokens: null,
    totalCostUsd: 0.08,
    startedAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:05:10Z',
    durationMs: 310000,
    durationFormatted: '5m 10s',
    storiesPassed: 1,
    storiesTotal: 3,
  },
];

const FIXTURE_PROGRESS = [
  '[EPIC-001] started',
  'US-001 building',
  'US-001 validating',
  'US-002 FAIL: acceptance criteria not met',
].join('\n');

test('parseEpicsFromPrd assigns correct states using stats and progress', () => {
  const epics = parseEpicsFromPrd(FIXTURE_PRD, FIXTURE_STATS_EPICS, FIXTURE_PROGRESS);

  assert.equal(epics.length, 1);
  const stories = epics[0].stories;
  assert.equal(stories.length, 3);

  // US-001: passes=true -> pass
  assert.equal(stories[0].state, 'pass');
  assert.equal(stories[0].duration, '2m 0s');

  // US-002: passes=false, statsCompleted=true, statsPassed=false -> fail
  assert.equal(stories[1].state, 'fail');
  assert.equal(stories[1].failureReason, 'acceptance criteria not met');
  assert.equal(stories[1].duration, '3m 10s');

  // US-003: no stats, no progress signals -> queued
  assert.equal(stories[2].state, 'queued');
});

test('parseEpicsFromPrd without progress content still assigns pass/fail from stats', () => {
  const epics = parseEpicsFromPrd(FIXTURE_PRD, FIXTURE_STATS_EPICS, null);

  const stories = epics[0].stories;
  assert.equal(stories[0].state, 'pass');
  assert.equal(stories[1].state, 'fail');
  assert.equal(stories[1].failureReason, null); // no progress content
});

// ---------------------------------------------------------------------------
// parseCyclesFromProgress
// ---------------------------------------------------------------------------

test('parseCyclesFromProgress returns empty array for empty content', () => {
  assert.deepEqual(parseCyclesFromProgress('', 'US-001'), []);
});

test('parseCyclesFromProgress returns empty array when story not mentioned', () => {
  const content = '## 2024-01-01 — US-002 - Other Story\nResult: PASS (attempt 1/2)\n---';
  assert.deepEqual(parseCyclesFromProgress(content, 'US-001'), []);
});

test('parseCyclesFromProgress parses single PASS cycle from structured block', () => {
  const content = [
    '## 2024-01-01 — US-001 - My Story',
    'Result: PASS (attempt 1/2)',
    '- What was implemented: everything',
    '- Validator verdict summary: all tests pass',
    '---',
  ].join('\n');
  const cycles = parseCyclesFromProgress(content, 'US-001');
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].attempt, 1);
  assert.equal(cycles[0].result, 'pass');
  assert.equal(cycles[0].failureDetail, null);
});

test('parseCyclesFromProgress parses single FAIL cycle from structured block', () => {
  const content = [
    '## 2024-01-01 — US-001 - My Story',
    'Result: FAIL (attempt 1/2)',
    '- What was attempted: something',
    '- Validator feedback: typecheck not passing',
    '---',
  ].join('\n');
  const cycles = parseCyclesFromProgress(content, 'US-001');
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].attempt, 1);
  assert.equal(cycles[0].result, 'fail');
  assert.ok(cycles[0].failureDetail !== null, 'should have failureDetail');
});

test('parseCyclesFromProgress parses two cycles (fail then pass)', () => {
  const content = [
    '## 2024-01-01 — US-001 - My Story',
    'Result: FAIL (attempt 1/2)',
    '- Validator feedback: tests failed',
    '---',
    '## 2024-01-01 — US-001 - My Story',
    'Result: PASS (attempt 2/2)',
    '- All tests now pass',
    '---',
  ].join('\n');
  const cycles = parseCyclesFromProgress(content, 'US-001');
  assert.equal(cycles.length, 2);
  assert.equal(cycles[0].attempt, 1);
  assert.equal(cycles[0].result, 'fail');
  assert.equal(cycles[1].attempt, 2);
  assert.equal(cycles[1].result, 'pass');
});

test('parseCyclesFromProgress parses two FAIL cycles', () => {
  const content = [
    '## 2024-01-01 — US-003 - Hard Story',
    'Result: FAIL (attempt 1/2)',
    '- Validator feedback: missing acceptance criteria',
    '---',
    '## 2024-01-01 — US-003 - Hard Story',
    'Result: FAIL (attempt 2/2)',
    '- Validator feedback: still missing criteria',
    '---',
  ].join('\n');
  const cycles = parseCyclesFromProgress(content, 'US-003');
  assert.equal(cycles.length, 2);
  assert.equal(cycles[0].result, 'fail');
  assert.equal(cycles[1].result, 'fail');
});

test('parseCyclesFromProgress orders cycles by attempt number', () => {
  // Blocks in reverse order in content
  const content = [
    '## date — US-001 - My Story',
    'Result: PASS (attempt 2/2)',
    '---',
    '## date — US-001 - My Story',
    'Result: FAIL (attempt 1/2)',
    '---',
  ].join('\n');
  const cycles = parseCyclesFromProgress(content, 'US-001');
  assert.equal(cycles[0].attempt, 1);
  assert.equal(cycles[1].attempt, 2);
});

test('parseCyclesFromProgress falls back to line-scan when no structured blocks', () => {
  const content = [
    'US-001 PASS — implemented feature',
  ].join('\n');
  const cycles = parseCyclesFromProgress(content, 'US-001');
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].result, 'pass');
});

test('parseCyclesFromProgress fallback handles FAIL with reason', () => {
  const content = 'US-002 FAIL: tests not passing — see log';
  const cycles = parseCyclesFromProgress(content, 'US-002');
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].result, 'fail');
  assert.ok(cycles[0].failureDetail !== null);
});

test('parseCyclesFromProgress ignores blocks for other stories', () => {
  const content = [
    '## date — US-002 - Other Story',
    'Result: FAIL (attempt 1/2)',
    '---',
    '## date — US-001 - My Story',
    'Result: PASS (attempt 1/2)',
    '---',
  ].join('\n');
  const cycles = parseCyclesFromProgress(content, 'US-001');
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].result, 'pass');
});
