import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discussCommand } from '../src/commands/discuss';
import { ExitSignal } from './helpers';
import type { FailedStoryContext } from '../src/discuss';

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-discuss-command-'));
}

function writeProjectFile(projectDir: string, relativePath: string, content: string): void {
  const absolutePath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf-8');
}

test('discussCommand gathers failed stories and starts a guided session', async () => {
  const projectDir = makeProject();
  const prdPath = path.join(projectDir, 'prd.json');

  writeProjectFile(projectDir, 'prd.json', JSON.stringify({
    project: 'Demo',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Foundation',
        status: 'partial',
        dependsOn: [],
        userStories: [
          { id: 'US-001', title: 'Passed story', passes: true, failureReason: null },
          { id: 'US-002', title: 'Failed story', passes: false, failureReason: 'typecheck error' },
        ],
      },
    ],
  }, null, 2));

  writeProjectFile(projectDir, 'ralph-teams/progress.txt', [
    '## 2026-03-16 — US-002 - Failed story',
    'Result: FAIL (attempt 2/2)',
    '- Validator verdict: FAIL — typecheck error',
    '---',
  ].join('\n'));

  writeProjectFile(projectDir, 'ralph-teams/plans/plan-EPIC-001.md', [
    '# Plan',
    '## US-002 — Failed story',
    'Fix the broken imports and rerun validation.',
  ].join('\n'));

  let capturedContexts: FailedStoryContext[] | null = null;
  let capturedBackend: string | null = null;

  await discussCommand(prdPath, { backend: 'codex' }, {
    cwd: () => projectDir,
    exit: ((code?: number) => { throw new ExitSignal(code); }) as (code?: number) => never,
    loadConfig: () => ({
      timeouts: { epicTimeout: 3600, idleTimeout: 300 },
      execution: { validatorMaxPushbacks: 1, parallel: 0, backend: 'claude' },
      pricing: {
        inputTokenCostPer1k: 0.015,
        outputTokenCostPer1k: 0.075,
        cacheReadCostPer1k: 0.0015,
        cacheCreationCostPer1k: 0.01875,
      },
    }),
    ensureBackendAvailable: (backend) => {
      capturedBackend = backend;
    },
    runFailedStoriesDiscussSession: async (contexts, options) => {
      capturedContexts = contexts;
      capturedBackend = options?.backend ?? null;
    },
  });

  assert.equal(capturedBackend, 'codex');
  assert.ok(capturedContexts !== null);
  assert.equal(capturedContexts.length, 1);
  assert.equal(capturedContexts[0].storyId, 'US-002');
  assert.equal(capturedContexts[0].storyTitle, 'Failed story');
  assert.equal(capturedContexts[0].failureReason, 'typecheck error');
  assert.match(capturedContexts[0].failureReport, /Validator verdict/);
  assert.match(capturedContexts[0].planSection, /broken imports/i);
  assert.equal(
    capturedContexts[0].guidancePath,
    path.resolve(projectDir, 'ralph-teams', 'guidance', 'guidance-US-002.md'),
  );
});

test('discussCommand includes stories from failed epics even when failureReason is not yet present', async () => {
  const projectDir = makeProject();
  const prdPath = path.join(projectDir, 'prd.json');

  writeProjectFile(projectDir, 'prd.json', JSON.stringify({
    project: 'Demo',
    epics: [
      {
        id: 'EPIC-002',
        title: 'Search',
        status: 'failed',
        dependsOn: [],
        userStories: [
          { id: 'US-010', title: 'Search page', passes: false },
        ],
      },
    ],
  }, null, 2));

  let capturedCount = 0;
  await discussCommand(prdPath, {}, {
    cwd: () => projectDir,
    exit: ((code?: number) => { throw new ExitSignal(code); }) as (code?: number) => never,
    loadConfig: () => ({
      timeouts: { epicTimeout: 3600, idleTimeout: 300 },
      execution: { validatorMaxPushbacks: 1, parallel: 0, backend: 'claude' },
      pricing: {
        inputTokenCostPer1k: 0.015,
        outputTokenCostPer1k: 0.075,
        cacheReadCostPer1k: 0.0015,
        cacheCreationCostPer1k: 0.01875,
      },
    }),
    ensureBackendAvailable: () => {},
    runFailedStoriesDiscussSession: async (contexts) => {
      capturedCount = contexts.length;
    },
  });

  assert.equal(capturedCount, 1);
});

test('discussCommand exits cleanly when no failed stories are available', async () => {
  const projectDir = makeProject();
  const prdPath = path.join(projectDir, 'prd.json');

  writeProjectFile(projectDir, 'prd.json', JSON.stringify({
    project: 'Demo',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Foundation',
        status: 'completed',
        dependsOn: [],
        userStories: [
          { id: 'US-001', title: 'Passed story', passes: true, failureReason: null },
        ],
      },
    ],
  }, null, 2));

  await assert.rejects(
    discussCommand(prdPath, {}, {
      cwd: () => projectDir,
      exit: ((code?: number) => { throw new ExitSignal(code); }) as (code?: number) => never,
      loadConfig: () => ({
        timeouts: { epicTimeout: 3600, idleTimeout: 300 },
        execution: { validatorMaxPushbacks: 1, parallel: 0, backend: 'claude' },
        pricing: {
          inputTokenCostPer1k: 0.015,
          outputTokenCostPer1k: 0.075,
          cacheReadCostPer1k: 0.0015,
          cacheCreationCostPer1k: 0.01875,
        },
      }),
      ensureBackendAvailable: () => {
        throw new Error('should not check backend');
      },
      runFailedStoriesDiscussSession: async () => {
        throw new Error('should not run discuss session');
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExitSignal);
      assert.equal(error.code, 0);
      return true;
    },
  );
});
