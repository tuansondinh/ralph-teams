import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskExecutionPrompt,
  buildTaskPlanningPrompt,
  taskCommand,
} from '../src/commands/task';
import { DEFAULT_CONFIG } from '../src/config';
import { ExitSignal } from './helpers';

function makeConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

test('buildTaskPlanningPrompt keeps planning separate from implementation', () => {
  const prompt = buildTaskPlanningPrompt('add search filters', '/repo', 'main');

  assert.match(prompt, /ad hoc task planning session/i);
  assert.match(prompt, /Do not implement code in this session/i);
  assert.match(prompt, /Current branch: main/);
});

test('buildTaskExecutionPrompt references scoped teammate roles', () => {
  const prompt = buildTaskExecutionPrompt('fix login bug', '/repo', 'feature/current');

  assert.match(prompt, /stay on the current branch/i);
  assert.match(prompt, /Do not create or switch branches/i);
  assert.match(prompt, /story_planner_easy\/story_planner_medium\/story_planner_difficult/);
  assert.match(prompt, /story-planner/i);
  assert.match(prompt, /story-validator/i);
  assert.match(prompt, /builder must do TDD/i);
});

test('taskCommand starts planning session when user chooses planning', async () => {
  let capturedPrompt = '';
  let capturedBackend = '';
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const config = makeConfig();
  config.execution.backend = 'claude';
  config.agents.storyPlanner = 'sonnet';

  await taskCommand('add audit logging', { backend: 'codex' }, {
    cwd: () => '/repo',
    exit: ((code?: number) => { throw new ExitSignal(code); }) as (code?: number) => never,
    loadConfig: () => config,
    loadExplicitAgentModelOverrides: () => ({ storyPlanner: 'opus' }),
    ensureBackendAvailable: (backend) => {
      capturedBackend = backend;
    },
    getCurrentBranch: () => 'feature/current',
    askShouldPlan: async () => true,
    runPlanningSession: async (prompt, backend, env) => {
      capturedPrompt = prompt;
      capturedBackend = backend;
      capturedEnv = env;
    },
    runExecutionSession: async () => {
      throw new Error('should not execute directly');
    },
  });

  assert.equal(capturedBackend, 'codex');
  assert.match(capturedPrompt, /add audit logging/);
  assert.equal(capturedEnv?.RALPH_MODEL_STORY_PLANNER_EXPLICIT, '1');
  assert.equal(capturedEnv?.RALPH_MODEL_TEAM_LEAD, 'gpt-5.4');
});

test('taskCommand starts execution session when user skips planning', async () => {
  let capturedPrompt = '';
  let capturedBackend = '';
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const config = makeConfig();

  await taskCommand('fix flaky test', {}, {
    cwd: () => '/repo',
    exit: ((code?: number) => { throw new ExitSignal(code); }) as (code?: number) => never,
    loadConfig: () => config,
    loadExplicitAgentModelOverrides: () => ({}),
    ensureBackendAvailable: (backend) => {
      capturedBackend = backend;
    },
    getCurrentBranch: () => 'main',
    askShouldPlan: async () => false,
    runPlanningSession: async () => {
      throw new Error('should not plan');
    },
    runExecutionSession: async (prompt, backend, env) => {
      capturedPrompt = prompt;
      capturedBackend = backend;
      capturedEnv = env;
    },
  });

  assert.equal(capturedBackend, 'claude');
  assert.match(capturedPrompt, /Execute the task now/);
  assert.equal(capturedEnv?.RALPH_MODEL_BUILDER_EXPLICIT, '0');
  assert.equal(capturedEnv?.RALPH_MODEL_TEAM_LEAD, 'opus');
});

test('taskCommand maps abstract opencode defaults to zai coding-plan models', async () => {
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const config = makeConfig();

  await taskCommand('improve editor performance', { backend: 'opencode' }, {
    cwd: () => '/repo',
    exit: ((code?: number) => { throw new ExitSignal(code); }) as (code?: number) => never,
    loadConfig: () => config,
    loadExplicitAgentModelOverrides: () => ({}),
    ensureBackendAvailable: () => {},
    getCurrentBranch: () => 'main',
    askShouldPlan: async () => false,
    runPlanningSession: async () => {
      throw new Error('should not plan');
    },
    runExecutionSession: async (_prompt, _backend, env) => {
      capturedEnv = env;
    },
  });

  assert.equal(capturedEnv?.RALPH_MODEL_STORY_PLANNER, 'zai-coding-plan/glm-4.7-flash');
  assert.equal(capturedEnv?.RALPH_MODEL_BUILDER, 'zai-coding-plan/glm-4.7');
  assert.equal(capturedEnv?.RALPH_MODEL_TEAM_LEAD, 'zai-coding-plan/glm-5');
});

test('taskCommand treats execution.model as an explicit override for all roles', async () => {
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const config = makeConfig();
  config.execution.backend = 'codex';
  config.execution.model = 'gpt-5.1-codex-mini';
  config.agents.teamLead = 'gpt-5.1-codex-mini';
  config.agents.storyPlanner = 'gpt-5.1-codex-mini';
  config.agents.epicPlanner = 'gpt-5.1-codex-mini';
  config.agents.builder = 'gpt-5.1-codex-mini';
  config.agents.storyValidator = 'gpt-5.1-codex-mini';
  config.agents.epicValidator = 'gpt-5.1-codex-mini';
  config.agents.finalValidator = 'gpt-5.1-codex-mini';
  config.agents.merger = 'gpt-5.1-codex-mini';

  await taskCommand('use one model everywhere', {}, {
    cwd: () => '/repo',
    exit: ((code?: number) => { throw new ExitSignal(code); }) as (code?: number) => never,
    loadConfig: () => config,
    loadExplicitAgentModelOverrides: () => ({
      teamLead: 'gpt-5.1-codex-mini',
      storyPlanner: 'gpt-5.1-codex-mini',
      epicPlanner: 'gpt-5.1-codex-mini',
      builder: 'gpt-5.1-codex-mini',
      storyValidator: 'gpt-5.1-codex-mini',
      epicValidator: 'gpt-5.1-codex-mini',
      finalValidator: 'gpt-5.1-codex-mini',
      merger: 'gpt-5.1-codex-mini',
    }),
    ensureBackendAvailable: () => {},
    getCurrentBranch: () => 'main',
    askShouldPlan: async () => false,
    runPlanningSession: async () => {
      throw new Error('should not plan');
    },
    runExecutionSession: async (_prompt, _backend, env) => {
      capturedEnv = env;
    },
  });

  assert.equal(capturedEnv?.RALPH_MODEL_TEAM_LEAD, 'gpt-5.1-codex-mini');
  assert.equal(capturedEnv?.RALPH_MODEL_STORY_PLANNER, 'gpt-5.1-codex-mini');
  assert.equal(capturedEnv?.RALPH_MODEL_BUILDER, 'gpt-5.1-codex-mini');
  assert.equal(capturedEnv?.RALPH_MODEL_TEAM_LEAD_EXPLICIT, '1');
  assert.equal(capturedEnv?.RALPH_MODEL_BUILDER_EXPLICIT, '1');
  assert.equal(capturedEnv?.RALPH_MODEL_FINAL_VALIDATOR_EXPLICIT, '1');
});

test('taskCommand exits when no current branch is available', async () => {
  await assert.rejects(
    taskCommand('do something', {}, {
      cwd: () => '/repo',
      exit: ((code?: number) => { throw new ExitSignal(code); }) as (code?: number) => never,
      loadConfig: () => makeConfig(),
      loadExplicitAgentModelOverrides: () => ({}),
      ensureBackendAvailable: () => {},
      getCurrentBranch: () => null,
      askShouldPlan: async () => false,
      runExecutionSession: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExitSignal);
      assert.equal(error.code, 1);
      return true;
    },
  );
});
