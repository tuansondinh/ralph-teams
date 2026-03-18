import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

import {
  readCodexPromptBody,
  readMarkdownPromptBody,
  repoRoot,
  scriptPath,
} from './helpers/ralph-shell-helpers.js';

test('epic planner prompt assets require writing the epic plan markdown file', () => {
  const promptFiles = [
    'prompts/agents/epic-planner.md',
    '.opencode/agents/epic-planner.md',
    '.codex/agents/epic-planner.toml',
    '.github/agents/epic-planner.agent.md',
    '.claude/agents/epic-planner.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(`${repoRoot}/${relativePath}`, 'utf-8');
    assert.match(content, /write.*plan.*(path|disk)|persist.*disk/i);
    assert.match(content, /\.ralph-teams\/plans\/plan-\{?epic-id\}?\.md|\.ralph-teams\/plans\/plan-<epic-id>\.md|plans\/plan-\{?epic-id\}?\.md|plans\/plan-<epic-id>\.md/i);
    assert.match(content, /do not ask the team lead to copy, save, or rewrite the plan|write the file yourself before replying/i);
  }
});

test('epic planner prompt assets require designing story-level tests', () => {
  const promptFiles = [
    'prompts/agents/epic-planner.md',
    '.opencode/agents/epic-planner.md',
    '.codex/agents/epic-planner.toml',
    '.github/agents/epic-planner.agent.md',
    '.claude/agents/epic-planner.md',
    'prompts/team-lead-policy.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(`${repoRoot}/${relativePath}`, 'utf-8');
    assert.match(content, /design.*test|tests to add \/ update|verification commands/i);
  }
});

test('epic planner prompt assets require design-level plans instead of code dumps', () => {
  const promptFiles = [
    'prompts/agents/epic-planner.md',
    '.opencode/agents/epic-planner.md',
    '.codex/agents/epic-planner.toml',
    '.github/agents/epic-planner.agent.md',
    '.claude/agents/epic-planner.md',
    'prompts/team-lead-policy.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(`${repoRoot}/${relativePath}`, 'utf-8');
    assert.match(content, /high-level implementation\/design plan|implementation\/design-plan level|design level|junior implementer/i);
    assert.match(content, /may include function signatures|signature or prop contract is acceptable|should not include full functions|do not include full function bodies|no.*pseudocode/i);
  }
});

test('builder prompt assets require reading provided planning context', () => {
  const promptFiles = [
    'prompts/agents/builder.md',
    '.opencode/agents/builder.md',
    '.codex/agents/builder.toml',
    '.github/agents/builder.agent.md',
    '.claude/agents/builder.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(`${repoRoot}/${relativePath}`, 'utf-8');
    assert.match(content, /Read any provided planning context|epic plan|story plan|validator report/i);
  }
});

test('builder prompt assets require test creation and TDD fallback when planning is skipped', () => {
  const promptFiles = [
    'prompts/agents/builder.md',
    '.opencode/agents/builder.md',
    '.codex/agents/builder.toml',
    '.github/agents/builder.agent.md',
    '.claude/agents/builder.md',
    'prompts/team-lead-policy.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(`${repoRoot}/${relativePath}`, 'utf-8');
    assert.match(content, /create or update.*test|add or update.*test|tests changed|zero new or updated tests/i);
    assert.match(content, /TDD|define.*tests first|make them fail/i);
  }
});

test('story planner prompt assets stay story-scoped and design-focused', () => {
  const promptFiles = [
    'prompts/agents/story-planner.md',
    '.opencode/agents/story-planner.md',
    '.codex/agents/story-planner.toml',
    '.github/agents/story-planner.agent.md',
    '.claude/agents/story-planner.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(`${repoRoot}/${relativePath}`, 'utf-8');
    assert.match(content, /single user story|story-scoped/i);
    assert.match(content, /Tests To Add \/ Update|automated tests/i);
    assert.match(content, /do not implement code|design level/i);
  }
});

test('scoped validator prompt assets cover story, epic, and final validation', () => {
  const promptFiles = [
    'prompts/agents/story-validator.md',
    'prompts/agents/epic-validator.md',
    'prompts/agents/final-validator.md',
    '.opencode/agents/story-validator.md',
    '.opencode/agents/epic-validator.md',
    '.opencode/agents/final-validator.md',
    '.codex/agents/story-validator.toml',
    '.codex/agents/epic-validator.toml',
    '.codex/agents/final-validator.toml',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(`${repoRoot}/${relativePath}`, 'utf-8');
    assert.match(content, /VERDICT: PASS \/ FAIL|VERDICT: PASS|PASS \/ FAIL/i);
    assert.match(content, /NEVER fix code|do not implement fixes/i);
  }
});

test('generated worker agent prompts stay in sync with canonical shared prompts', () => {
  const roles = ['story-planner', 'epic-planner', 'builder', 'story-validator', 'epic-validator', 'final-validator', 'merger'];

  for (const role of roles) {
    const canonical = readMarkdownPromptBody(`prompts/agents/${role}.md`);
    assert.equal(readMarkdownPromptBody(`.claude/agents/${role}.md`), canonical);
    assert.equal(readMarkdownPromptBody(`.opencode/agents/${role}.md`), canonical);
    assert.equal(readMarkdownPromptBody(`.github/agents/${role}.agent.md`), canonical);
    assert.equal(readCodexPromptBody(`.codex/agents/${role}.toml`), canonical);
  }
});

test('team lead wrappers reference the canonical Team Lead policy file', () => {
  const promptFiles = [
    '.github/agents/team-lead.agent.md',
    '.claude/agents/team-lead.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(`${repoRoot}/${relativePath}`, 'utf-8');
    assert.match(content, /prompts\/team-lead-policy\.md/);
  }
});

test('ralph.sh loads the canonical Team Lead policy for runtime prompts', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /TEAM_LEAD_POLICY_FILE=.*prompts\/team-lead-policy\.md/);
  assert.match(script, /TEAM_LEAD_POLICY="\$\(cat \"\$TEAM_LEAD_POLICY_FILE\"\)"/);
  assert.match(script, /## Canonical Team Lead Policy/);
});

test('canonical Team Lead policy covers scoped planner and validator heuristics', () => {
  const content = fs.readFileSync(`${repoRoot}/prompts/team-lead-policy.md`, 'utf-8');

  assert.match(content, /If `epicPlanning\.enabled = 1`, spawn the epic planner/i);
  assert.match(content, /explicitly tell the epic planner the exact output path/i);
  assert.match(content, /Treat an epic planner response as incomplete/i);
  assert.match(content, /verify that the plan file exists at the required path/i);
  assert.match(content, /storyPlanning\.enabled = 1/i);
  assert.match(content, /storyValidation\.enabled = 1/i);
  assert.match(content, /epicValidation\.enabled = 1/i);
  assert.match(content, /If you are unsure, spawn the story validator/i);
  assert.match(content, /If you are unsure, spawn the epic validator/i);
  assert.match(content, /Print `DONE: X\/Y stories passed` and exit immediately/i);
});

test('claude team-lead prompt uses difficulty-based model selection unless config overrides are set', () => {
  const content = fs.readFileSync(`${repoRoot}/.claude/agents/team-lead.md`, 'utf-8');

  assert.match(content, /If `RALPH_MODEL_STORY_PLANNER_EXPLICIT=1`, use `RALPH_MODEL_STORY_PLANNER`/);
  assert.match(content, /If `RALPH_MODEL_EPIC_PLANNER_EXPLICIT=1`, use `RALPH_MODEL_EPIC_PLANNER`/);
  assert.match(content, /If `RALPH_MODEL_BUILDER_EXPLICIT=1`, use `RALPH_MODEL_BUILDER`/);
  assert.match(content, /If `RALPH_MODEL_STORY_VALIDATOR_EXPLICIT=1`, use `RALPH_MODEL_STORY_VALIDATOR`/);
  assert.match(content, /If `RALPH_MODEL_EPIC_VALIDATOR_EXPLICIT=1`, use `RALPH_MODEL_EPIC_VALIDATOR`/);
  assert.match(content, /If `RALPH_MODEL_FINAL_VALIDATOR_EXPLICIT=1`, use `RALPH_MODEL_FINAL_VALIDATOR`/);
  assert.match(content, /easy task -> `haiku`/);
  assert.match(content, /medium task -> `sonnet`/);
  assert.match(content, /difficult task -> `opus`/);
});

test('claude team-lead prompt requires one-shot builder spawns instead of a persistent mailbox', () => {
  const content = fs.readFileSync(`${repoRoot}/.claude/agents/team-lead.md`, 'utf-8');

  assert.match(content, /prompts\/team-lead-policy\.md/);
  assert.match(content, /spawn a fresh Builder/i);
  assert.match(content, /subagent_type: "story-validator"/);
  assert.match(content, /subagent_type: "builder"/);
  assert.match(content, /Do NOT use `SendMessage` or `shutdown_request`/);
  assert.doesNotMatch(content, /wait for story assignments from you via direct messages/i);
  assert.doesNotMatch(content, /Send Builder a direct message/i);
});

test('copilot team-lead prompt uses difficulty-based model selection unless config overrides are set', () => {
  const content = fs.readFileSync(`${repoRoot}/.github/agents/team-lead.agent.md`, 'utf-8');

  assert.match(content, /If `RALPH_MODEL_STORY_PLANNER_EXPLICIT=1`, use `RALPH_MODEL_STORY_PLANNER`/);
  assert.match(content, /If `RALPH_MODEL_EPIC_PLANNER_EXPLICIT=1`, use `RALPH_MODEL_EPIC_PLANNER`/);
  assert.match(content, /If `RALPH_MODEL_BUILDER_EXPLICIT=1`, use `RALPH_MODEL_BUILDER`/);
  assert.match(content, /If `RALPH_MODEL_STORY_VALIDATOR_EXPLICIT=1`, use `RALPH_MODEL_STORY_VALIDATOR`/);
  assert.match(content, /If `RALPH_MODEL_EPIC_VALIDATOR_EXPLICIT=1`, use `RALPH_MODEL_EPIC_VALIDATOR`/);
  assert.match(content, /If `RALPH_MODEL_FINAL_VALIDATOR_EXPLICIT=1`, use `RALPH_MODEL_FINAL_VALIDATOR`/);
  assert.match(content, /easy task -> `gpt-5-mini`/);
  assert.match(content, /medium task -> `gpt-5\.3-codex`/);
  assert.match(content, /difficult task -> `gpt-5\.4`/);
  assert.match(content, /reasoning-effort/);
});

test('copilot team-lead prompt requires one-shot builder spawns instead of reusing teammates across stories', () => {
  const content = fs.readFileSync(`${repoRoot}/.github/agents/team-lead.agent.md`, 'utf-8');

  assert.match(content, /prompts\/team-lead-policy\.md/);
  assert.match(content, /spawn a fresh `builder` agent/i);
  assert.match(content, /story-validator/i);
  assert.match(content, /Do NOT keep Builder or Validator alive across stories/i);
});

test('ralph.sh maps abstract model tiers to backend-specific copilot and codex models', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /copilot:haiku[\s\S]*gpt-5-mini/);
  assert.match(script, /copilot:sonnet[\s\S]*gpt-5\.3-codex/);
  assert.match(script, /copilot:opus[\s\S]*gpt-5\.4/);
  assert.match(script, /codex:haiku[\s\S]*gpt-5-mini/);
  assert.match(script, /codex:sonnet[\s\S]*gpt-5\.3-codex/);
  assert.match(script, /codex:opus[\s\S]*gpt-5\.4/);
  assert.match(script, /opencode:haiku[\s\S]*zai-coding-plan\/glm-4\.7-flash/);
  assert.match(script, /opencode:sonnet[\s\S]*zai-coding-plan\/glm-4\.7/);
  assert.match(script, /opencode:opus[\s\S]*zai-coding-plan\/glm-5/);
  assert.match(script, /--agent team-lead --model \$MODEL_TEAM_LEAD/);
  assert.match(script, /-m "\$MODEL_TEAM_LEAD"/);
  assert.match(script, /--agent "\$agent_name"[\s\S]*--model "\$model"/);
});

test('ralph.sh launches opencode from the repo root so named agents remain discoverable', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /run_opencode_exec\(\)[\s\S]*cd "\$ROOT_DIR"[\s\S]*opencode run/);
  assert.match(script, /run_opencode_exec\(\)[\s\S]*--dir "\$workdir"/);
});

test('ralph.sh prepares codex teammate variants so the team lead can choose per-task models', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /prepare_codex_agent_configs\(\)/);
  assert.match(script, /agents\.story_planner_easy\.config_file/);
  assert.match(script, /agents\.epic_planner_easy\.config_file/);
  assert.match(script, /agents\.builder_easy\.config_file/);
  assert.match(script, /agents\.story_validator_easy\.config_file/);
  assert.match(script, /agents\.epic_validator_easy\.config_file/);
  assert.match(script, /agents\.final_validator_easy\.config_file/);
  assert.match(script, /If your runtime is Codex, use these exact named teammate roles when spawning/);
});

test('ralph.sh requires one-shot builder and validator runs for shared team-lead prompt backends', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /TEAM_LEAD_POLICY="\$\(cat \"\$TEAM_LEAD_POLICY_FILE\"\)"/);
  assert.match(script, /## Runtime-Specific Notes/);
  assert.match(script, /If your runtime supports named sub-agents, use the dedicated story-planner, epic-planner, builder, story-validator, and epic-validator roles/i);
  assert.match(script, /spawn a new Builder for the retry instead of reusing the previous Builder run/i);
  assert.match(script, /If your runtime is Codex exec mode, `request_user_input` is unavailable/i);
});

test('ralph.sh team lead prompt forbids epic replanning when the PRD already marks the epic planned', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /## Planning Status/);
  assert.match(script, /epic\.planned = \$\{EPIC_PLANNED\}/);
  assert.match(script, /canonical_plan\.exists = \$\{WORKTREE_PLAN_EXISTS\}/);
  assert.match(script, /If epic\.planned = true, do NOT spawn the epic planner/);
  assert.match(script, /If epic\.planned = true and canonical_plan\.exists = true, read the canonical plan file above and execute against it/);
  assert.match(script, /Only spawn the epic planner when epic\.planned is not true and epicPlanning\.enabled = 1/);
});
