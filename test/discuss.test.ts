/**
 * test/discuss.test.ts — Tests for the discuss module.
 *
 * Tests:
 *  - parseFailureReport: extracts failure entries from progress.txt
 *  - extractPlanSection: extracts the relevant heading from a plan markdown file
 *  - findEpicForStory: looks up the epic ID for a given story in prd.json
 *  - gatherDiscussContext: integration of the above (with mocked file paths)
 *  - runDiscussSession: session loop collects user messages and returns guidance
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import {
  parseFailureReport,
  extractPlanSection,
  findEpicForStory,
  gatherDiscussContext,
  runDiscussSession,
  type DiscussContext,
} from '../src/discuss';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'discuss-test-'));
}

function writeFile(dir: string, filename: string, content: string): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// parseFailureReport
// ---------------------------------------------------------------------------

describe('parseFailureReport', () => {
  let tmpDir: string;

  before(() => { tmpDir = makeTempDir(); });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns not-found message when progress.txt does not exist', () => {
    const result = parseFailureReport(path.join(tmpDir, 'nonexistent.txt'), 'US-001');
    assert.ok(result.includes('not found'));
  });

  it('extracts FAIL section for a matching story', () => {
    const content = [
      '## 2026-01-01 — US-018 - Discuss agent',
      'Result: FAIL (attempt 1/2)',
      '- typecheck did not pass',
      '---',
      '## 2026-01-02 — US-019 - Other story',
      'Result: PASS (attempt 1/2)',
    ].join('\n');

    const progressPath = writeFile(tmpDir, 'progress1.txt', content);
    const result = parseFailureReport(progressPath, 'US-018');

    assert.ok(result.includes('US-018'));
    assert.ok(result.includes('FAIL'));
    assert.ok(result.includes('typecheck did not pass'));
  });

  it('does not include sections for other stories', () => {
    const content = [
      '## 2026-01-01 — US-018 - Discuss agent',
      'Result: FAIL (attempt 1/2)',
      '- typecheck did not pass',
      '---',
      '## 2026-01-02 — US-019 - Other story',
      'Result: FAIL (attempt 2/2)',
      '- different failure',
    ].join('\n');

    const progressPath = writeFile(tmpDir, 'progress2.txt', content);
    const result = parseFailureReport(progressPath, 'US-018');

    assert.ok(result.includes('US-018'));
    assert.ok(!result.includes('US-019'));
    assert.ok(!result.includes('different failure'));
  });

  it('returns fallback section when no FAIL entries found', () => {
    const content = [
      '## 2026-01-01 — US-018 - Discuss agent',
      'Result: PASS (attempt 1/2)',
      '- everything worked',
    ].join('\n');

    const progressPath = writeFile(tmpDir, 'progress3.txt', content);
    const result = parseFailureReport(progressPath, 'US-018');

    // Falls back to any section mentioning the story
    assert.ok(result.includes('US-018'));
  });

  it('returns not-found message when story does not appear in progress.txt', () => {
    const content = '## 2026-01-01 — US-999\nResult: PASS\n';
    const progressPath = writeFile(tmpDir, 'progress4.txt', content);
    const result = parseFailureReport(progressPath, 'US-018');
    assert.ok(result.includes('no progress entry found for US-018'));
  });

  it('collects multiple FAIL sections for the same story', () => {
    const content = [
      '## 2026-01-01 — US-018 - Discuss (attempt 1)',
      'Result: FAIL (attempt 1/2)',
      '- first failure',
      '---',
      '## 2026-01-02 — US-018 - Discuss (attempt 2)',
      'Result: FAIL (attempt 2/2)',
      '- second failure',
    ].join('\n');

    const progressPath = writeFile(tmpDir, 'progress5.txt', content);
    const result = parseFailureReport(progressPath, 'US-018');

    assert.ok(result.includes('first failure'));
    assert.ok(result.includes('second failure'));
  });
});

// ---------------------------------------------------------------------------
// extractPlanSection
// ---------------------------------------------------------------------------

describe('extractPlanSection', () => {
  let tmpDir: string;

  before(() => { tmpDir = makeTempDir(); });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns not-found message when plan file does not exist', () => {
    const result = extractPlanSection(tmpDir, 'EPIC-999', 'US-001');
    assert.ok(result.includes('not found'));
  });

  it('extracts the section for the matching story heading', () => {
    const planContent = [
      '# Plan',
      '',
      '## US-018 — Discuss Agent',
      '',
      'This section describes US-018.',
      '',
      '## US-019 — Next Story',
      '',
      'This describes US-019.',
    ].join('\n');

    writeFile(tmpDir, 'plan-EPIC-004.md', planContent);
    const result = extractPlanSection(tmpDir, 'EPIC-004', 'US-018');

    assert.ok(result.includes('US-018'));
    assert.ok(result.includes('This section describes US-018'));
    assert.ok(!result.includes('US-019'));
    assert.ok(!result.includes('This describes US-019'));
  });

  it('captures nested sub-headings under the story section', () => {
    const planContent = [
      '## US-018 — Discuss Agent',
      '',
      'Overview.',
      '',
      '### Sub-section',
      '',
      'Detail here.',
      '',
      '## US-019 — Next Story',
    ].join('\n');

    writeFile(tmpDir, 'plan-EPIC-005.md', planContent);
    const result = extractPlanSection(tmpDir, 'EPIC-005', 'US-018');

    assert.ok(result.includes('Overview'));
    assert.ok(result.includes('Sub-section'));
    assert.ok(result.includes('Detail here'));
    assert.ok(!result.includes('US-019'));
  });

  it('returns not-found message when story ID is not in plan', () => {
    const planContent = '## US-001 — Other\n\nSome content.\n';
    writeFile(tmpDir, 'plan-EPIC-006.md', planContent);
    const result = extractPlanSection(tmpDir, 'EPIC-006', 'US-018');
    assert.ok(result.includes('no plan section found for US-018'));
  });

  it('captures content until end of file for last section', () => {
    const planContent = [
      '## US-018 — Last Story',
      '',
      'Final content here.',
    ].join('\n');

    writeFile(tmpDir, 'plan-EPIC-007.md', planContent);
    const result = extractPlanSection(tmpDir, 'EPIC-007', 'US-018');

    assert.ok(result.includes('Final content here'));
  });
});

// ---------------------------------------------------------------------------
// findEpicForStory
// ---------------------------------------------------------------------------

describe('findEpicForStory', () => {
  let tmpDir: string;

  before(() => { tmpDir = makeTempDir(); });
  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty string when prd.json does not exist', () => {
    const result = findEpicForStory(path.join(tmpDir, 'nonexistent.json'), 'US-001');
    assert.equal(result, '');
  });

  it('returns the correct epic ID for a story', () => {
    const prd = {
      epics: [
        {
          id: 'EPIC-001',
          userStories: [{ id: 'US-001' }, { id: 'US-002' }],
        },
        {
          id: 'EPIC-002',
          userStories: [{ id: 'US-003' }, { id: 'US-004' }],
        },
      ],
    };
    const prdPath = writeFile(tmpDir, 'prd1.json', JSON.stringify(prd));
    assert.equal(findEpicForStory(prdPath, 'US-003'), 'EPIC-002');
  });

  it('returns empty string when story is not found', () => {
    const prd = {
      epics: [
        { id: 'EPIC-001', userStories: [{ id: 'US-001' }] },
      ],
    };
    const prdPath = writeFile(tmpDir, 'prd2.json', JSON.stringify(prd));
    assert.equal(findEpicForStory(prdPath, 'US-999'), '');
  });

  it('handles malformed prd.json gracefully', () => {
    const prdPath = writeFile(tmpDir, 'prd-bad.json', '{ invalid json ');
    const result = findEpicForStory(prdPath, 'US-001');
    assert.equal(result, '');
  });
});

// ---------------------------------------------------------------------------
// gatherDiscussContext
// ---------------------------------------------------------------------------

describe('gatherDiscussContext', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = makeTempDir();

    // Create prd.json
    const prd = {
      epics: [
        {
          id: 'EPIC-004',
          userStories: [{ id: 'US-018' }, { id: 'US-019' }],
        },
      ],
    };
    writeFile(tmpDir, 'prd.json', JSON.stringify(prd));

    // Create progress.txt
    const progress = [
      '## 2026-01-01 — US-018 - Discuss agent',
      'Result: FAIL (attempt 2/2)',
      '- All attempts failed',
      '---',
    ].join('\n');
    writeFile(tmpDir, 'progress.txt', progress);

    // Create plans/plan-EPIC-004.md
    fs.mkdirSync(path.join(tmpDir, 'plans'), { recursive: true });
    const plan = [
      '# Plan for EPIC-004',
      '',
      '## US-018 — Discuss Agent',
      '',
      'Implement the discuss module.',
      '',
      '## US-019 — Next Story',
      '',
      'Something else.',
    ].join('\n');
    writeFile(path.join(tmpDir, 'plans'), 'plan-EPIC-004.md', plan);
  });

  after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns a DiscussContext with the correct storyId and epicId', () => {
    const ctx = gatherDiscussContext(
      'US-018',
      path.join(tmpDir, 'prd.json'),
      path.join(tmpDir, 'progress.txt'),
      path.join(tmpDir, 'plans'),
      tmpDir,  // worktreeDir — no git repo here, expects graceful fallback
    );

    assert.equal(ctx.storyId, 'US-018');
    assert.equal(ctx.epicId, 'EPIC-004');
  });

  it('populates failureReport from progress.txt', () => {
    const ctx = gatherDiscussContext(
      'US-018',
      path.join(tmpDir, 'prd.json'),
      path.join(tmpDir, 'progress.txt'),
      path.join(tmpDir, 'plans'),
      tmpDir,
    );

    assert.ok(ctx.failureReport.includes('US-018'));
    assert.ok(ctx.failureReport.includes('FAIL'));
  });

  it('populates planSection from plan file', () => {
    const ctx = gatherDiscussContext(
      'US-018',
      path.join(tmpDir, 'prd.json'),
      path.join(tmpDir, 'progress.txt'),
      path.join(tmpDir, 'plans'),
      tmpDir,
    );

    assert.ok(ctx.planSection.includes('Implement the discuss module'));
    assert.ok(!ctx.planSection.includes('Something else'));
  });

  it('returns a codeDiff string (may be a fallback message)', () => {
    const ctx = gatherDiscussContext(
      'US-018',
      path.join(tmpDir, 'prd.json'),
      path.join(tmpDir, 'progress.txt'),
      path.join(tmpDir, 'plans'),
      tmpDir,
    );

    // codeDiff may be an error message when no git repo is present — just check it's a string
    assert.equal(typeof ctx.codeDiff, 'string');
  });
});

// ---------------------------------------------------------------------------
// runDiscussSession
// ---------------------------------------------------------------------------

describe('runDiscussSession', () => {
  /** Creates a mock readline interface that emits canned answers. */
  function makeMockReadline(answers: string[]): readline.Interface {
    const answerQueue = [...answers];

    const mockRl = {
      question: (_prompt: string, callback: (answer: string) => void) => {
        const answer = answerQueue.shift() ?? '';
        // Use setImmediate to simulate async behavior without blocking
        setImmediate(() => callback(answer));
      },
      close: () => { /* no-op */ },
      once: (_event: string, _cb: () => void) => { /* no-op for 'close' */ },
    } as unknown as readline.Interface;

    return mockRl;
  }

  const baseContext: DiscussContext = {
    storyId: 'US-018',
    epicId: 'EPIC-004',
    failureReport: 'typecheck failed',
    codeDiff: 'src/discuss.ts | 1 +',
    planSection: 'Implement the discuss module.',
  };

  it('returns storyId in the result', async () => {
    const rl = makeMockReadline(['done']);
    const result = await runDiscussSession(baseContext, rl);
    assert.equal(result.storyId, 'US-018');
  });

  it('returns empty guidance when user types "done" immediately', async () => {
    const rl = makeMockReadline(['done']);
    const result = await runDiscussSession(baseContext, rl);
    assert.equal(result.guidance, '');
  });

  it('returns empty guidance when user types empty line', async () => {
    const rl = makeMockReadline(['']);
    const result = await runDiscussSession(baseContext, rl);
    assert.equal(result.guidance, '');
  });

  it('collects a single message as guidance', async () => {
    const rl = makeMockReadline(['Focus on fixing the type error', 'done']);
    const result = await runDiscussSession(baseContext, rl);
    assert.equal(result.guidance, 'Focus on fixing the type error');
  });

  it('collects multiple messages joined with newlines', async () => {
    const rl = makeMockReadline([
      'First piece of guidance',
      'Second piece of guidance',
      'done',
    ]);
    const result = await runDiscussSession(baseContext, rl);
    assert.equal(result.guidance, 'First piece of guidance\nSecond piece of guidance');
  });

  it('exits when user types "exit"', async () => {
    const rl = makeMockReadline(['Some guidance', 'exit']);
    const result = await runDiscussSession(baseContext, rl);
    assert.equal(result.guidance, 'Some guidance');
  });

  it('trims whitespace from user input', async () => {
    const rl = makeMockReadline(['  fix the bug  ', 'done']);
    const result = await runDiscussSession(baseContext, rl);
    assert.equal(result.guidance, 'fix the bug');
  });
});
