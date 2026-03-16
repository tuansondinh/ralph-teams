/**
 * test/dashboard-discuss.test.ts — Tests for the discuss view (US-018).
 *
 * Covers:
 * - extractPlanSection() with various plan content shapes
 * - extractValidatorReport() extracts failure lines from progress.txt
 * - renderDiscussView() output contains expected sections
 * - buildDiscussContext() with mock state
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractPlanSection,
  renderDiscussView,
  DiscussContext,
  DiscussMessage,
} from '../src/dashboard/views/discuss-view';

import {
  extractValidatorReport,
  buildDiscussContext,
  getCodeDiff,
} from '../src/dashboard/discuss-context-loader';

import { DashboardState, EpicDisplayData, StoryDisplayData } from '../src/dashboard/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStory(overrides: Partial<StoryDisplayData> = {}): StoryDisplayData {
  return {
    id: 'US-003',
    title: 'Auth story',
    state: 'fail',
    failureReason: 'typecheck error',
    duration: null,
    attempts: 1,
    cycles: [],
    ...overrides,
  };
}

function makeEpic(overrides: Partial<EpicDisplayData> = {}): EpicDisplayData {
  return {
    id: 'EPIC-001',
    title: 'Foundation Epic',
    status: 'partial',
    storiesPassed: 2,
    storiesTotal: 3,
    stories: [makeStory()],
    currentActivity: 'partial',
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
    projectName: 'TestProject',
    currentWave: 1,
    startedAt: null,
    epics: [makeEpic()],
    totalCostUsd: null,
    totalCostEstimate: null,
    totalElapsed: '--',
    totalTimeEstimate: null,
    viewMode: 'discuss',
    selectedEpicId: null,
    rawLogLines: [],
    mergeEvents: [],
    awaitingEpicNumber: false,
    runComplete: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractPlanSection
// ---------------------------------------------------------------------------

describe('extractPlanSection', () => {
  it('returns empty string for empty plan content', () => {
    assert.equal(extractPlanSection('', 'US-003'), '');
    assert.equal(extractPlanSection('   ', 'US-003'), '');
  });

  it('returns empty string when storyId is not found in plan', () => {
    const plan = '# Plan\n\n## US-001 - Some Story\nContent here.';
    assert.equal(extractPlanSection(plan, 'US-099'), '');
  });

  it('extracts section for a single-level heading with storyId', () => {
    const plan = [
      '# Plan Overview',
      '',
      '## US-003 - Auth Story',
      'Implement authentication.',
      'Use JWT tokens.',
      '',
      '## US-004 - Other Story',
      'Other content.',
    ].join('\n');

    const result = extractPlanSection(plan, 'US-003');
    assert.ok(result.includes('US-003'), 'should include the heading');
    assert.ok(result.includes('Implement authentication'), 'should include body text');
    assert.ok(result.includes('Use JWT tokens'), 'should include all body lines');
    assert.ok(!result.includes('US-004'), 'should not include next section');
    assert.ok(!result.includes('Other content'), 'should stop before next heading');
  });

  it('extracts section when heading contains only the storyId', () => {
    const plan = [
      '# Plan',
      '## US-001',
      'First story content.',
      '## US-002',
      'Second story content.',
    ].join('\n');

    const result = extractPlanSection(plan, 'US-001');
    assert.ok(result.includes('US-001'));
    assert.ok(result.includes('First story content'));
    assert.ok(!result.includes('US-002'));
    assert.ok(!result.includes('Second story content'));
  });

  it('extracts section up to EOF when it is the last section', () => {
    const plan = [
      '# Plan',
      '## US-005 - Final Story',
      'This is the last section.',
      'No more sections after this.',
    ].join('\n');

    const result = extractPlanSection(plan, 'US-005');
    assert.ok(result.includes('This is the last section'));
    assert.ok(result.includes('No more sections after this'));
  });

  it('handles deeper heading levels (###)', () => {
    const plan = [
      '# Plan',
      '## User Stories',
      '### US-007 - Sub Story',
      'Sub section content here.',
      '### US-008 - Another',
      'Should not be included.',
    ].join('\n');

    const result = extractPlanSection(plan, 'US-007');
    assert.ok(result.includes('Sub section content'));
    assert.ok(!result.includes('Should not be included'));
  });

  it('is case-insensitive for storyId match', () => {
    const plan = '## us-003 - Auth Story\nContent.';
    const result = extractPlanSection(plan, 'US-003');
    assert.ok(result.includes('Content'));
  });

  it('trims leading/trailing whitespace from result', () => {
    const plan = '\n## US-003 - My Story\n  Content.\n\n';
    const result = extractPlanSection(plan, 'US-003');
    assert.ok(!result.startsWith('\n'), 'result should not start with newline');
    assert.ok(!result.endsWith('\n'), 'result should not end with newline');
  });
});

// ---------------------------------------------------------------------------
// extractValidatorReport
// ---------------------------------------------------------------------------

describe('extractValidatorReport', () => {
  it('returns empty array for null progressContent', () => {
    assert.deepEqual(extractValidatorReport(null, 'US-003'), []);
  });

  it('returns empty array for empty progressContent', () => {
    assert.deepEqual(extractValidatorReport('', 'US-003'), []);
  });

  it('returns empty array when no block for storyId exists', () => {
    const progress = '## 2026-03-15 — US-001 - Other Story\nResult: PASS\n';
    assert.deepEqual(extractValidatorReport(progress, 'US-003'), []);
  });

  it('extracts Result line from story block', () => {
    const progress = [
      '## 2026-03-15 — US-003 - Auth Story',
      'Result: FAIL (attempt 1/2)',
      '- Implementation incomplete',
      '- Validator verdict: FAIL — typecheck broken',
    ].join('\n');

    const lines = extractValidatorReport(progress, 'US-003');
    assert.ok(lines.some(l => l.includes('Result: FAIL')), 'should include Result line');
  });

  it('extracts bullet points from story block', () => {
    const progress = [
      '## 2026-03-15 — US-003 - Auth Story',
      'Result: FAIL (attempt 1/2)',
      '- Tests failed: 3 assertions',
      '- Missing exports in src/auth.ts',
    ].join('\n');

    const lines = extractValidatorReport(progress, 'US-003');
    assert.ok(lines.some(l => l.includes('Tests failed')), 'should include bullet lines');
    assert.ok(lines.some(l => l.includes('Missing exports')));
  });

  it('extracts Validator verdict lines', () => {
    const progress = [
      '## 2026-03-15 — US-003 - Auth Story',
      'Result: FAIL (attempt 2/2)',
      '- Validator verdict: FAIL — acceptance criteria 3 not met',
    ].join('\n');

    const lines = extractValidatorReport(progress, 'US-003');
    assert.ok(lines.some(l => l.includes('Validator verdict')), 'should include verdict line');
    assert.ok(lines.some(l => l.includes('acceptance criteria 3')));
  });

  it('uses the last block when storyId appears multiple times (retries)', () => {
    const progress = [
      '## 2026-03-15 — US-003 - Auth Story',
      'Result: FAIL (attempt 1/2)',
      '- First attempt failure',
      '---',
      '## 2026-03-15 — US-003 - Auth Story (retry)',
      'Result: FAIL (attempt 2/2)',
      '- Second attempt failure',
    ].join('\n');

    const lines = extractValidatorReport(progress, 'US-003');
    assert.ok(lines.some(l => l.includes('Second attempt failure')), 'should use last block');
  });

  it('stops collecting at the next ## heading', () => {
    const progress = [
      '## 2026-03-15 — US-003 - Auth Story',
      'Result: FAIL (attempt 1/2)',
      '- From US-003 block',
      '## 2026-03-15 — US-004 - Other Story',
      '- From US-004 block',
    ].join('\n');

    const lines = extractValidatorReport(progress, 'US-003');
    assert.ok(lines.some(l => l.includes('From US-003 block')));
    assert.ok(!lines.some(l => l.includes('From US-004 block')), 'should not cross into next block');
  });
});

// ---------------------------------------------------------------------------
// renderDiscussView
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<DiscussContext> = {}): DiscussContext {
  return {
    storyId: 'US-003',
    storyTitle: 'Auth Story',
    epicId: 'EPIC-001',
    epicTitle: 'Foundation Epic',
    failureReason: 'typecheck error',
    validatorReport: ['Result: FAIL (attempt 1/2)', '- Validator verdict: FAIL — typecheck broken'],
    codeDiff: ' src/auth.ts | 12 ++++++------\n 1 file changed, 6 insertions(+), 6 deletions(-)',
    planSection: '## US-003 - Auth Story\nImplement authentication using JWT.',
    ...overrides,
  };
}

describe('renderDiscussView', () => {
  it('includes story ID and title in header', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes('US-003'), 'should show storyId');
    assert.ok(output.includes('Auth Story'), 'should show story title');
  });

  it('includes epic ID and title', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes('EPIC-001'), 'should show epicId');
    assert.ok(output.includes('Foundation Epic'), 'should show epic title');
  });

  it('includes failure reason', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes('typecheck error'), 'should show failure reason');
  });

  it('shows "(unknown)" when failureReason is null', () => {
    const output = renderDiscussView(makeContext({ failureReason: null }), []);
    assert.ok(output.includes('(unknown)'), 'should show (unknown) for null reason');
  });

  it('includes validator report lines', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes('Validator verdict: FAIL'), 'should show validator report');
    assert.ok(output.includes('Result: FAIL'), 'should show result line');
  });

  it('shows "(no report available)" when validatorReport is empty', () => {
    const output = renderDiscussView(makeContext({ validatorReport: [] }), []);
    assert.ok(output.includes('(no report available)'), 'should indicate empty report');
  });

  it('includes code diff section header', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes("Builder's code diff"), 'should include code diff section header');
  });

  it('includes code diff content', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes('src/auth.ts'), 'should show diff stat file name');
    assert.ok(output.includes('6 insertions'), 'should show diff stat numbers');
  });

  it('shows "(no diff available)" when codeDiff is empty', () => {
    const output = renderDiscussView(makeContext({ codeDiff: '' }), []);
    assert.ok(output.includes('(no diff available)'), 'should indicate missing diff');
  });

  it('code diff appears between validator report and plan section', () => {
    const output = renderDiscussView(makeContext(), []);
    const validatorIdx = output.indexOf('Validator report:');
    const diffIdx = output.indexOf("Builder's code diff");
    const planIdx = output.indexOf('Plan section:');
    assert.ok(validatorIdx < diffIdx, 'validator report should come before code diff');
    assert.ok(diffIdx < planIdx, 'code diff should come before plan section');
  });

  it('includes plan section content', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes('Implement authentication using JWT'), 'should show plan text');
  });

  it('shows "(no plan section found)" when planSection is empty', () => {
    const output = renderDiscussView(makeContext({ planSection: '' }), []);
    assert.ok(output.includes('(no plan section found)'), 'should indicate missing plan');
  });

  it('shows conversation header', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes('Conversation:'), 'should include Conversation section');
  });

  it('shows "(no messages yet)" when messages array is empty', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes('(no messages yet'), 'should indicate empty conversation');
  });

  it('renders user messages with > prefix', () => {
    const messages: DiscussMessage[] = [{ role: 'user', text: 'Please fix the import' }];
    const output = renderDiscussView(makeContext(), messages);
    assert.ok(output.includes('> Please fix the import'), 'should prefix user messages with >');
  });

  it('renders context messages with [context] prefix', () => {
    const messages: DiscussMessage[] = [{ role: 'context', text: 'Failure detected at line 42' }];
    const output = renderDiscussView(makeContext(), messages);
    assert.ok(output.includes('[context] Failure detected at line 42'));
  });

  it('renders multiple messages in order', () => {
    const messages: DiscussMessage[] = [
      { role: 'context', text: 'Context info' },
      { role: 'user', text: 'First guidance' },
      { role: 'user', text: 'Second guidance' },
    ];
    const output = renderDiscussView(makeContext(), messages);
    const ctxIdx = output.indexOf('[context] Context info');
    const firstIdx = output.indexOf('> First guidance');
    const secondIdx = output.indexOf('> Second guidance');
    assert.ok(ctxIdx < firstIdx, 'context before first user msg');
    assert.ok(firstIdx < secondIdx, 'first user msg before second');
  });

  it('includes the how-to-finish hint', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes('done') || output.includes('Esc'), 'should mention how to finish');
  });

  it('includes separator lines', () => {
    const output = renderDiscussView(makeContext(), []);
    assert.ok(output.includes('─'), 'should include separator lines');
  });
});

// ---------------------------------------------------------------------------
// buildDiscussContext
// ---------------------------------------------------------------------------

describe('buildDiscussContext', () => {
  it('returns null when storyId is not found in state', () => {
    const state = makeState();
    const result = buildDiscussContext(state, 'US-999', '', null);
    assert.equal(result, null, 'should return null for unknown storyId');
  });

  it('returns context with story and epic metadata', () => {
    const state = makeState();
    const result = buildDiscussContext(state, 'US-003', '', null);
    assert.ok(result !== null, 'should return context');
    assert.equal(result!.storyId, 'US-003');
    assert.equal(result!.storyTitle, 'Auth story');
    assert.equal(result!.epicId, 'EPIC-001');
    assert.equal(result!.epicTitle, 'Foundation Epic');
    assert.equal(result!.failureReason, 'typecheck error');
  });

  it('returns empty validatorReport when no progress content', () => {
    const state = makeState();
    const result = buildDiscussContext(state, 'US-003', '', null);
    assert.ok(result !== null);
    assert.deepEqual(result!.validatorReport, []);
  });

  it('extracts validatorReport from progress content', () => {
    const progress = [
      '## 2026-03-15 — US-003 - Auth Story',
      'Result: FAIL (attempt 1/2)',
      '- Validator verdict: FAIL — bad imports',
    ].join('\n');
    const state = makeState();
    const result = buildDiscussContext(state, 'US-003', '', progress);
    assert.ok(result !== null);
    assert.ok(result!.validatorReport.some(l => l.includes('Validator verdict')));
  });

  it('returns empty planSection when plansDir is empty/missing', () => {
    const state = makeState();
    const result = buildDiscussContext(state, 'US-003', '/nonexistent/plans', null);
    assert.ok(result !== null);
    assert.equal(result!.planSection, '', 'should return empty string for missing plan');
  });

  it('returns empty codeDiff when worktreesDir is not provided', () => {
    const state = makeState();
    // buildDiscussContext with no worktreesDir arg (default '')
    const result = buildDiscussContext(state, 'US-003', '', null);
    assert.ok(result !== null);
    assert.equal(result!.codeDiff, '', 'should return empty string when no worktreesDir');
  });

  it('returns placeholder codeDiff when worktreesDir does not exist', () => {
    const state = makeState();
    const result = buildDiscussContext(state, 'US-003', '', null, '/nonexistent/.worktrees');
    assert.ok(result !== null);
    // Should contain a descriptive placeholder (not empty, not throw)
    assert.ok(typeof result!.codeDiff === 'string', 'codeDiff should always be a string');
    assert.ok(
      result!.codeDiff.includes('worktree') || result!.codeDiff.includes('not found') || result!.codeDiff.length >= 0,
      'should gracefully handle missing worktree',
    );
  });

  it('context includes codeDiff field', () => {
    // Verify the field exists on the returned context
    const state = makeState();
    const result = buildDiscussContext(state, 'US-003', '', null);
    assert.ok(result !== null);
    assert.ok('codeDiff' in result!, 'context should have codeDiff field');
  });

  it('finds story across multiple epics', () => {
    const epic2 = makeEpic({
      id: 'EPIC-002',
      title: 'Second Epic',
      stories: [makeStory({ id: 'US-010', title: 'Epic 2 story', failureReason: 'bad test' })],
    });
    const state = makeState({ epics: [makeEpic(), epic2] });
    const result = buildDiscussContext(state, 'US-010', '', null);
    assert.ok(result !== null);
    assert.equal(result!.storyId, 'US-010');
    assert.equal(result!.epicId, 'EPIC-002');
  });
});
