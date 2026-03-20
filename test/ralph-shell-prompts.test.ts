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
    assert.match(content, /WROTE: <path>/i);
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

test('builder prompt assets require repository-driven command inference before verification', () => {
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
    assert.match(content, /infer.*setup.*build.*test commands|infer project commands/i);
    assert.match(content, /AGENTS\.md|README/i);
    assert.match(content, /Makefile|justfile|Taskfile\.yml|package scripts|repo-defined/i);
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
    if (relativePath.includes('final-validator')) {
      assert.match(content, /Result Artifact Path|write a JSON file|machine-readable result artifact/i);
      assert.match(content, /PRD File Path|read the PRD|requirements contract|PRD requirement coverage/i);
      assert.match(content, /"final-validation"|phase.*final-validation|verdict.*pass.*fail/i);
      assert.match(content, /captures stdout into its own raw validation log|Never overwrite, truncate, or rewrite/i);
      assert.match(content, /Allowed final-fix retries|spawn the Builder directly|you may spawn the Builder directly/i);
      assert.match(content, /merge-failed.*epics/i);
      assert.match(content, /attempt a clean merge retry/i);
      assert.match(content, /do not hand merge-conflict resolution to a fresh Team Lead session/i);
      assert.doesNotMatch(content, /log_file.*final validation log path provided by the caller/i);
    }
    assert.match(content, /NEVER fix code|do not implement fixes|Never edit code yourself/i);
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
  const runtimePrompt = fs.readFileSync(`${repoRoot}/prompts/team-lead-runtime.md`, 'utf-8');

  assert.match(script, /TEAM_LEAD_POLICY_FILE=.*prompts\/team-lead-policy\.md/);
  assert.match(script, /TEAM_LEAD_PROMPT_FILE=.*prompts\/team-lead-runtime\.md/);
  assert.match(script, /TEAM_LEAD_POLICY="\$\(cat \"\$TEAM_LEAD_POLICY_FILE\"\)"/);
  assert.match(script, /TEAM_PROMPT="\$\(render_team_lead_prompt\)"/);
  assert.match(script, /TEAM_LEAD_TEMPLATE_PATH="\$TEAM_LEAD_PROMPT_FILE"/);
  assert.match(runtimePrompt, /## Canonical Team Lead Policy/);
  assert.match(runtimePrompt, /## Project Setup Strategy/);
  assert.match(runtimePrompt, /Ralph does not preinstall dependencies or preselect build\/test commands/);
  assert.match(runtimePrompt, /Check repo instructions first: 'AGENTS\.md', 'README\*'/);
  assert.doesNotMatch(runtimePrompt, /Check repo instructions first: `AGENTS\.md`, `README\*`/);
  assert.match(runtimePrompt, /\{\{PROJECT\}\}/);
  assert.match(runtimePrompt, /\{\{TEAM_LEAD_POLICY\}\}/);
});

test('ralph.sh enables Claude agent teams in in-process mode for the claude backend', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');
  const runtimePrompt = fs.readFileSync(`${repoRoot}/prompts/team-lead-runtime.md`, 'utf-8');

  assert.match(script, /--teammate-mode in-process/);
  assert.match(script, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="\$\{CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-1\}"/);
  assert.match(runtimePrompt, /If your runtime is Claude, use Claude agent teams/i);
  assert.match(runtimePrompt, /use direct teammate messaging when coordination helps/i);
});

test('canonical Team Lead policy covers scoped planner and validator heuristics', () => {
  const content = fs.readFileSync(`${repoRoot}/prompts/team-lead-policy.md`, 'utf-8');

  assert.match(content, /If a usable canonical plan file already exists at the path provided in the prompt, do not spawn the epic planner/i);
  assert.match(content, /If `epicPlanning\.enabled = 1`, spawn the epic planner/i);
  assert.match(content, /explicitly tell the epic planner the exact output path/i);
  assert.match(content, /WROTE: <path>/i);
  assert.match(content, /Treat an epic planner response as incomplete/i);
  assert.match(content, /verify that the plan file exists at the required path/i);
  assert.match(content, /may write that exact plan to the canonical path and continue/i);
  assert.match(content, /Do not rerun the planner only for the missing file write/i);
  assert.match(content, /Keep the Team Lead orchestration-first/i);
  assert.match(content, /Do not do open-ended architecture tours, large file sweeps, or broad grep passes yourself/i);
  assert.match(content, /storyPlanning\.enabled = 1/i);
  assert.match(content, /storyValidation\.enabled = 1/i);
  assert.match(content, /epicValidation\.enabled = 1/i);
  assert.match(content, /If you are unsure, spawn the story validator/i);
  assert.match(content, /If you are unsure, spawn the epic validator/i);
  assert.match(content, /Only print `DONE: X\/Y stories passed` after the merge attempt and merge-result artifact write are finished/i);
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

test('claude team-lead prompt uses Claude agent teams for delegated work', () => {
  const content = fs.readFileSync(`${repoRoot}/.claude/agents/team-lead.md`, 'utf-8');

  assert.match(content, /prompts\/team-lead-policy\.md/);
  assert.match(content, /Use Claude agent teams, not Claude subagents/i);
  assert.match(content, /TeamCreate/);
  assert.match(content, /SendMessage/);
  assert.match(content, /fresh Builder/i);
  assert.match(content, /validators independent from builder reasoning/i);
  assert.match(content, /Builder-to-validator direct messaging is restricted to artifact or status handoff only/i);
  assert.match(content, /Do not let the Builder send reasoning, verdict framing, acceptance-criteria arguments, or coaching/i);
  assert.doesNotMatch(content, /subagent_type:/);
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
  assert.doesNotMatch(content, /reasoning-effort/);
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
  assert.match(script, /-m "\$MODEL_TEAM_LEAD"/);
  assert.match(script, /--agent "\$agent_name"[\s\S]*--model "\$model"/);
});

test('copilot shell launch relies on agent markdown models instead of forcing CLI model flags', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /gh copilot -- --agent team-lead --allow-all --no-ask-user --stream on -p/);
  assert.match(script, /gh copilot -- --agent "\$0" --allow-all --no-ask-user --stream on -p "\$1"/);
  assert.doesNotMatch(script, /gh copilot -- --agent team-lead --model /);
  assert.doesNotMatch(script, /gh copilot -- --agent "\$0" --model /);
});

test('ralph.sh injects opencode agent definitions into the workdir before launching', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /inject_opencode_agents\(\)/);
  assert.match(script, /run_opencode_exec\(\)[\s\S]*inject_opencode_agents "\$workdir"/);
  assert.match(script, /run_opencode_exec\(\)[\s\S]*cd "\$workdir"[\s\S]*opencode run/);
  assert.doesNotMatch(script, /run_opencode_exec\(\)[\s\S]*--dir "\$workdir"/);
});

test('ralph.sh prepares codex teammate variants so the team lead can choose per-task models', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');
  const runtimePrompt = fs.readFileSync(`${repoRoot}/prompts/team-lead-runtime.md`, 'utf-8');

  assert.match(script, /prepare_codex_agent_configs\(\)/);
  assert.match(script, /agents\.story_planner_easy\.config_file/);
  assert.match(script, /agents\.epic_planner_easy\.config_file/);
  assert.match(script, /agents\.builder_easy\.config_file/);
  assert.match(script, /agents\.story_validator_easy\.config_file/);
  assert.match(script, /agents\.epic_validator_easy\.config_file/);
  assert.match(script, /agents\.final_validator_easy\.config_file/);
  assert.match(runtimePrompt, /If your runtime is Codex, use these exact named teammate roles when spawning/);
});

test('team lead runtime prompt keeps the lead in orchestration mode', () => {
  const runtimePrompt = fs.readFileSync(`${repoRoot}/prompts/team-lead-runtime.md`, 'utf-8');

  assert.match(runtimePrompt, /You are the Team Lead for execution, not the primary implementer or explorer/i);
  assert.match(runtimePrompt, /Keep your own repo exploration minimal and delegate the actual work/i);
  assert.match(runtimePrompt, /## Merge Responsibility/);
  assert.match(runtimePrompt, /this same Team Lead session owns the merge attempt before exiting/i);
});

test('team lead policy requires in-session merge ownership with a scripted artifact handoff', () => {
  const policy = fs.readFileSync(`${repoRoot}/prompts/team-lead-policy.md`, 'utf-8');

  assert.match(policy, /## Merge Completion/);
  assert.match(policy, /same Team Lead session must attempt the merge before exiting/i);
  assert.match(policy, /merge-result artifact/i);
});

test('codex shell launches add the Ralph package directory alongside the project workspace', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /run_codex_exec "\$WORKTREE_ABS_PATH" "\$TEAM_PROMPT" --add-dir "\$ROOT_DIR" --add-dir "\$SCRIPT_DIR"/);
  assert.match(script, /codex[\s\S]*-m "\$MODEL_TEAM_LEAD"[\s\S]*-c model_reasoning_effort='"high"'/);
  assert.match(script, /codex[\s\S]*--add-dir "\$SCRIPT_DIR"/);
  assert.match(script, /codex[\s\S]*--add-dir "\$ROOT_DIR"[\s\S]*--add-dir "\$SCRIPT_DIR"[\s\S]*- > "\$log_file"/);
});

test('ralph.sh stages a runtime-local rjq binary inside .ralph-teams/bin and prepends it to PATH', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /ensure_runtime_rjq_bin\(\)/);
  assert.match(script, /local runtime_bin_dir="\$\{RALPH_RUNTIME_DIR\}\/bin"/);
  assert.match(script, /local runtime_rjq_bin="\$\{runtime_bin_dir\}\/rjq"/);
  assert.match(script, /cp "\$source_rjq_bin" "\$runtime_rjq_bin"/);
  assert.match(script, /export RALPH_RJQ_BIN="\$runtime_rjq_bin"/);
  assert.match(script, /export PATH="\$\{runtime_bin_dir\}:\$PATH"/);
});

test('ralph.sh repairs a merged-in root runtime symlink and keeps runtime artifacts out of git commits', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /repair_root_runtime_dir_if_needed\(\)/);
  assert.match(script, /if \[ -L "\$RALPH_RUNTIME_DIR" \]; then/);
  assert.match(script, /git rm --cached -r --ignore-unmatch "\$RALPH_RUNTIME_DIRNAME"/);
  assert.match(script, /git add -A[\s\S]*unstage_runtime_artifacts/);
  assert.match(script, /git merge "\$\{branch_name\}" --no-commit --no-ff[\s\S]*repair_root_runtime_dir_if_needed/);
  assert.match(script, /if \[ -f "\.git\/MERGE_HEAD" \]; then[\s\S]*git commit --no-edit/);
});

test('ralph.sh banner shows the workflow preset without enabled phases when a preset is present', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /WORKFLOW_PRESET="\$\{RALPH_WORKFLOW_PRESET:-\}"/);
  assert.match(script, /render_enabled_execution_phases\(\)/);
  assert.match(script, /echo "  Workflow: \$WORKFLOW_PRESET"/);
  assert.doesNotMatch(script, /echo "  Workflow: \$WORKFLOW_PRESET \(enabled phases: \$\(render_enabled_execution_phases\)\)"/);
  assert.match(script, /echo "  Execution phases enabled: \$\(render_enabled_execution_phases\)"/);
});

test('ralph.sh finalization always reinitializes counters after pending-merge recovery', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /recover_pending_merges "finalization" \|\| true/);
  assert.match(script, /recover_pending_merges "finalization" \|\| true\s+initialize_counters/);
  assert.doesNotMatch(script, /if ! recover_pending_merges "finalization"; then[\s\S]*initialize_counters[\s\S]*fi\s+initialize_counters/);
});

test('ralph.sh final validation reads the machine-readable result artifact', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /validation_run_id="\$\(date \+%s\)-\$\$-0"/);
  assert.match(script, /validation_result_file="\$\{STATE_DIR\}\/final-validation-result-\$\{validation_run_id\}\.json"/);
  assert.match(script, /validation_log="\$\{LOGS_DIR\}\/final-validation-\$\{validation_run_id\}\.log"/);
  assert.match(script, /## PRD File Path/);
  assert.match(script, /Validate the final implementation against the PRD, not just the code and tests/);
  assert.match(script, /## Result Artifact Path/);
  assert.match(script, /read_final_validation_verdict\(\)/);
  assert.match(script, /verdict="\$\(rjq read "\$result_file" \.verdict ""/);
  assert.match(script, /Do not overwrite or rewrite any Ralph log files/);
  assert.doesNotMatch(script, /Set log_file in the result artifact to exactly \$validation_log/);
});

test('ralph.sh requires one-shot builder and validator runs for shared team-lead prompt backends', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');
  const runtimePrompt = fs.readFileSync(`${repoRoot}/prompts/team-lead-runtime.md`, 'utf-8');

  assert.match(script, /TEAM_LEAD_POLICY="\$\(cat \"\$TEAM_LEAD_POLICY_FILE\"\)"/);
  assert.match(runtimePrompt, /## Runtime-Specific Notes/);
  assert.match(runtimePrompt, /If your runtime supports named sub-agents, use the dedicated story-planner, epic-planner, builder, story-validator, and epic-validator roles/i);
  assert.match(runtimePrompt, /spawn a new Builder for the retry instead of reusing the previous Builder run/i);
  assert.match(runtimePrompt, /If your runtime is Codex exec mode, `request_user_input` is unavailable/i);
});

test('ralph.sh escapes request_user_input in the shell-built team lead prompt', () => {
  const runtimePrompt = fs.readFileSync(`${repoRoot}/prompts/team-lead-runtime.md`, 'utf-8');

  assert.match(runtimePrompt, /If your runtime is Codex exec mode, `request_user_input` is unavailable/);
});

test('ralph.sh team lead prompt forbids epic replanning when the PRD already marks the epic planned', () => {
  const runtimePrompt = fs.readFileSync(`${repoRoot}/prompts/team-lead-runtime.md`, 'utf-8');

  assert.match(runtimePrompt, /## Planning Status/);
  assert.match(runtimePrompt, /epic\.planned = \{\{EPIC_PLANNED\}\}/);
  assert.match(runtimePrompt, /canonical_plan\.exists = \{\{WORKTREE_PLAN_EXISTS\}\}/);
  assert.match(runtimePrompt, /If a usable canonical plan already exists, do NOT spawn the epic planner\. Use it even if epic\.planned is false/);
  assert.match(runtimePrompt, /Only spawn the epic planner when epicPlanning\.enabled = 1 and there is no usable canonical plan for this epic/);
});
