import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildPlanPrompt,
  collectUnplannedEpics,
  planCommand,
} from '../src/commands/plan';
import { ExitSignal } from './helpers';

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-plan-test-'));
}

function writeProjectFile(projectDir: string, relativePath: string, content: string): string {
  const filePath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

test('collectUnplannedEpics returns only epics with planned !== true', () => {
  const plansDir = '/tmp/plans';
  const result = collectUnplannedEpics([
    {
      id: 'EPIC-001',
      title: 'Planned',
      status: 'pending',
      planned: true,
      userStories: [],
    },
    {
      id: 'EPIC-002',
      title: 'Unplanned',
      status: 'pending',
      planned: false,
      dependsOn: ['EPIC-001'],
      userStories: [
        { id: 'US-001', title: 'Story', passes: false, failureReason: null },
      ],
    },
  ], plansDir);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'EPIC-002');
  assert.equal(result[0].planPath, path.resolve('/tmp/plans/plan-EPIC-002.md'));
});

test('buildPlanPrompt tells the agent to discuss and mark planned epics', () => {
  const prompt = buildPlanPrompt('/tmp/prd.json', [
    {
      id: 'EPIC-001',
      title: 'Foundation',
      description: 'Core app setup',
      dependsOn: [],
      planned: false,
      planPath: '/tmp/plans/plan-EPIC-001.md',
      userStories: [
        { id: 'US-001', title: 'Auth story', acceptanceCriteria: ['Typecheck passes'] },
      ],
    },
  ], '/tmp/plans');

  assert.match(prompt, /plan all unplanned epics now or only a subset/i);
  assert.match(prompt, /update the epic in the PRD to set planned=true/i);
  assert.match(prompt, /Write plan to: \/tmp\/plans\/plan-EPIC-001\.md/);
});

test('planCommand starts a planning session for unplanned epics', async () => {
  const projectDir = makeProject();
  const prdPath = writeProjectFile(projectDir, 'prd.json', JSON.stringify({
    project: 'Demo',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Foundation',
        status: 'pending',
        planned: false,
        dependsOn: [],
        userStories: [
          { id: 'US-001', title: 'Auth story', passes: false, failureReason: null },
        ],
      },
      {
        id: 'EPIC-002',
        title: 'Already planned',
        status: 'pending',
        planned: true,
        dependsOn: ['EPIC-001'],
        userStories: [
          { id: 'US-002', title: 'Other story', passes: false, failureReason: null },
        ],
      },
    ],
  }, null, 2));

  let capturedPrompt = '';
  let capturedBackend = '';
  await planCommand(prdPath, { backend: 'codex' }, {
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
    spawnAgent: async (prompt) => {
      capturedPrompt = prompt;
      return '';
    },
  });

  assert.equal(capturedBackend, 'codex');
  assert.match(capturedPrompt, /EPIC-001/);
  assert.doesNotMatch(capturedPrompt, /Already planned/);
  assert.match(capturedPrompt, /planned=true/);
});

test('planCommand exits cleanly when all epics are already planned', async () => {
  const projectDir = makeProject();
  const prdPath = writeProjectFile(projectDir, 'prd.json', JSON.stringify({
    project: 'Demo',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Foundation',
        status: 'pending',
        planned: true,
        dependsOn: [],
        userStories: [
          { id: 'US-001', title: 'Auth story', passes: false, failureReason: null },
        ],
      },
    ],
  }, null, 2));

  await assert.rejects(
    planCommand(prdPath, {}, {
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
      spawnAgent: async () => {
        throw new Error('should not spawn');
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExitSignal);
      assert.equal(error.code, 0);
      return true;
    },
  );
});
