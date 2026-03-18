import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'ralph.sh');

// ralph.sh requires bash 4+ (uses declare -A). On macOS the system /bin/bash is 3.2,
// so we use the Homebrew bash 5 if available, otherwise fall back to PATH resolution.
const BASH = fs.existsSync('/opt/homebrew/bin/bash') ? '/opt/homebrew/bin/bash' : 'bash';

function readMarkdownPromptBody(relativePath: string): string {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
  return content.replace(/^---\n[\s\S]*?\n---\n\n(?:<!--.*?-->\n\n)?/, '').trim();
}

function readCodexPromptBody(relativePath: string): string {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
  const match = content.match(/developer_instructions = """\n([\s\S]*?)\n"""/);
  assert.ok(match, `${relativePath} should contain developer_instructions`);
  return match[1].trim();
}

test('planner prompt assets require writing the epic plan markdown file', () => {
  const promptFiles = [
    'prompts/agents/planner.md',
    '.opencode/agents/planner.md',
    '.codex/agents/planner.toml',
    '.github/agents/planner.agent.md',
    '.claude/agents/planner.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
    assert.match(
      content,
      /write.*plan.*(path|disk)|persist.*disk/i,
      `${relativePath} should require persisting the plan file`,
    );
    assert.match(
      content,
      /\.ralph-teams\/plans\/plan-\{?epic-id\}?\.md|\.ralph-teams\/plans\/plan-<epic-id>\.md|plans\/plan-\{?epic-id\}?\.md|plans\/plan-<epic-id>\.md/i,
      `${relativePath} should reference the epic markdown plan path`,
    );
    assert.match(
      content,
      /do not ask the team lead to copy, save, or rewrite the plan|write the file yourself before replying/i,
      `${relativePath} should require the planner to write the file itself`,
    );
  }
});

test('planner prompt assets require designing story-level tests', () => {
  const promptFiles = [
    'prompts/agents/planner.md',
    '.opencode/agents/planner.md',
    '.codex/agents/planner.toml',
    '.github/agents/planner.agent.md',
    '.claude/agents/planner.md',
    'prompts/team-lead-policy.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
    assert.match(
      content,
      /design.*test|tests to add \/ update|verification commands/i,
      `${relativePath} should require story-level test design`,
    );
  }
});

test('planner prompt assets require design-level plans instead of code dumps', () => {
  const promptFiles = [
    'prompts/agents/planner.md',
    '.opencode/agents/planner.md',
    '.codex/agents/planner.toml',
    '.github/agents/planner.agent.md',
    '.claude/agents/planner.md',
    'prompts/team-lead-policy.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
    assert.match(
      content,
      /high-level implementation\/design plan|implementation\/design-plan level|design level|junior implementer/i,
      `${relativePath} should require a design-level plan`,
    );
    assert.match(
      content,
      /may include function signatures|signature or prop contract is acceptable|should not include full functions|do not include full function bodies|no.*pseudocode/i,
      `${relativePath} should allow signatures but forbid full code`,
    );
  }
});

test('builder prompt assets require reading the epic plan markdown file', () => {
  const promptFiles = [
    'prompts/agents/builder.md',
    '.opencode/agents/builder.md',
    '.codex/agents/builder.toml',
    '.github/agents/builder.agent.md',
    '.claude/agents/builder.md',
  ];

  for (const relativePath of promptFiles) {
    const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
    assert.match(
      content,
      /read .*plan|check .*plan/i,
      `${relativePath} should require reading the plan file`,
    );
    assert.match(
      content,
      /\.ralph-teams\/plans\/plan-\{?epic-id\}?\.md|\.ralph-teams\/plans\/plan-<epic-id>\.md|plans\/plan-\{?epic-id\}?\.md|plans\/plan-<epic-id>\.md/i,
      `${relativePath} should reference the epic markdown plan path`,
    );
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
    const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
    assert.match(
      content,
      /create or update.*test|add or update.*test|tests changed|zero new or updated tests/i,
      `${relativePath} should require test creation or updates`,
    );
    assert.match(
      content,
      /TDD|define.*tests first|make them fail/i,
      `${relativePath} should require TDD fallback when no planner is used`,
    );
  }
});

test('generated worker agent prompts stay in sync with canonical shared prompts', () => {
  const roles = ['planner', 'builder', 'validator', 'merger'];

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
    const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
    assert.match(content, /prompts\/team-lead-policy\.md/);
  }
});

test('ralph.sh loads the canonical Team Lead policy for runtime prompts', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /TEAM_LEAD_POLICY_FILE=.*prompts\/team-lead-policy\.md/);
  assert.match(script, /TEAM_LEAD_POLICY="\$\(cat \"\$TEAM_LEAD_POLICY_FILE\"\)"/);
  assert.match(script, /## Canonical Team Lead Policy/);
});

test('canonical Team Lead policy covers planner and validator heuristics', () => {
  const content = fs.readFileSync(path.join(repoRoot, 'prompts/team-lead-policy.md'), 'utf-8');

  assert.match(content, /spawn the Planner for any medium- or high-complexity epic/i);
  assert.match(content, /explicitly tell the Planner the exact output path/i);
  assert.match(content, /Treat a Planner response as incomplete if it only pastes or summarizes the plan in chat/i);
  assert.match(content, /verify that the plan file exists at the required path/i);
  assert.match(content, /may include function signatures.*should not include full functions/i);
  assert.match(content, /Planner must design the automated tests for each story/i);
  assert.match(content, /If no Planner is spawned.*TDD order/i);
  assert.match(content, /Default to spawning the Validator for any medium- or high-complexity story/i);
  assert.match(content, /If you are unsure, spawn the Validator/i);
  assert.match(content, /Print `DONE: X\/Y stories passed` and exit immediately/i);
});

test('claude team-lead prompt uses difficulty-based model selection unless config overrides are set', () => {
  const content = fs.readFileSync(path.join(repoRoot, '.claude/agents/team-lead.md'), 'utf-8');

  assert.match(content, /If `RALPH_MODEL_PLANNER_EXPLICIT=1`, use `RALPH_MODEL_PLANNER`/);
  assert.match(content, /If `RALPH_MODEL_BUILDER_EXPLICIT=1`, use `RALPH_MODEL_BUILDER`/);
  assert.match(content, /If `RALPH_MODEL_VALIDATOR_EXPLICIT=1`, use `RALPH_MODEL_VALIDATOR`/);
  assert.match(content, /easy task -> `haiku`/);
  assert.match(content, /medium task -> `sonnet`/);
  assert.match(content, /difficult task -> `opus`/);
});

test('claude team-lead prompt requires one-shot builder spawns instead of a persistent mailbox', () => {
  const content = fs.readFileSync(path.join(repoRoot, '.claude/agents/team-lead.md'), 'utf-8');

  assert.match(content, /prompts\/team-lead-policy\.md/);
  assert.match(content, /spawn a fresh Builder/i);
  assert.match(content, /subagent_type: "builder"/);
  assert.match(content, /Do NOT use `SendMessage` or `shutdown_request`/);
  assert.doesNotMatch(content, /wait for story assignments from you via direct messages/i);
  assert.doesNotMatch(content, /Send Builder a direct message/i);
});

test('copilot team-lead prompt uses difficulty-based model selection unless config overrides are set', () => {
  const content = fs.readFileSync(path.join(repoRoot, '.github/agents/team-lead.agent.md'), 'utf-8');

  assert.match(content, /If `RALPH_MODEL_PLANNER_EXPLICIT=1`, use `RALPH_MODEL_PLANNER`/);
  assert.match(content, /If `RALPH_MODEL_BUILDER_EXPLICIT=1`, use `RALPH_MODEL_BUILDER`/);
  assert.match(content, /If `RALPH_MODEL_VALIDATOR_EXPLICIT=1`, use `RALPH_MODEL_VALIDATOR`/);
  assert.match(content, /easy task -> `gpt-5-mini`/);
  assert.match(content, /medium task -> `gpt-5\.3-codex`/);
  assert.match(content, /difficult task -> `gpt-5\.4`/);
  assert.match(content, /reasoning-effort/);
});

test('copilot team-lead prompt requires one-shot builder spawns instead of reusing teammates across stories', () => {
  const content = fs.readFileSync(path.join(repoRoot, '.github/agents/team-lead.agent.md'), 'utf-8');

  assert.match(content, /prompts\/team-lead-policy\.md/);
  assert.match(content, /spawn a fresh `builder` agent/i);
  assert.match(content, /spawn a fresh Validator/i);
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
  assert.match(script, /opencode:haiku[\s\S]*openai\/gpt-5-mini/);
  assert.match(script, /opencode:sonnet[\s\S]*openai\/gpt-5\.3-codex/);
  assert.match(script, /opencode:opus[\s\S]*openai\/gpt-5\.4/);
  assert.match(script, /--agent team-lead --model \$MODEL_TEAM_LEAD/);
  assert.match(script, /-m "\$MODEL_TEAM_LEAD"/);
  assert.match(script, /--agent "\$agent_name"[\s\S]*--model "\$model"/);
});

test('ralph.sh prepares codex teammate variants so the team lead can choose per-task models', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /prepare_codex_agent_configs\(\)/);
  assert.match(script, /agents\.planner_easy\.config_file/);
  assert.match(script, /agents\.planner_medium\.config_file/);
  assert.match(script, /agents\.planner_difficult\.config_file/);
  assert.match(script, /agents\.builder_easy\.config_file/);
  assert.match(script, /agents\.builder_medium\.config_file/);
  assert.match(script, /agents\.builder_difficult\.config_file/);
  assert.match(script, /agents\.validator_easy\.config_file/);
  assert.match(script, /agents\.validator_medium\.config_file/);
  assert.match(script, /agents\.validator_difficult\.config_file/);
  assert.match(script, /If your runtime is Codex, use these exact named teammate roles when spawning/);
});

test('ralph.sh requires one-shot builder and validator runs for shared team-lead prompt backends', () => {
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.match(script, /TEAM_LEAD_POLICY="\$\(cat \"\$TEAM_LEAD_POLICY_FILE\"\)"/);
  assert.match(script, /## Runtime-Specific Notes/);
  assert.match(script, /If your runtime supports named sub-agents, use the dedicated planner, builder, and validator roles/i);
  assert.match(script, /spawn a new Builder for the retry instead of reusing the previous Builder run/i);
});

function setupTempRepo() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-shell-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  fs.writeFileSync(path.join(binDir, 'claude'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

  fs.writeFileSync(path.join(tempDir, 'README.md'), 'initial\n');
  fs.writeFileSync(path.join(tempDir, 'prd.json'), JSON.stringify({
    project: 'Shell Test',
    branchName: 'feature/test-run',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Already done',
        status: 'completed',
        userStories: [
          { id: 'US-001', title: 'Done', passes: true },
        ],
      },
    ],
  }, null, 2));

  execFileSync('git', ['add', '.'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tempDir });

  fs.writeFileSync(path.join(tempDir, 'README.md'), 'changed\n');

  return { tempDir, binDir };
}

function setupUnbornRepo() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-unborn-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'if [ -n "$EPIC_ID" ]; then',
    '  node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[1];" +
      "const s=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "for (const v of Object.values(s.stories||{})) { v.passes=true; v.failureReason=null; }" +
      "fs.writeFileSync(f,JSON.stringify(s,null,2)+'\\n');" +
      '" "$STATE_PATH"',
    '  node -e "' +
      "const fs=require('fs');" +
      "const epic=process.argv[1];" +
      "const f=process.argv[2];" +
      "const p=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "const e=p.epics.find(x=>x.id===epic);" +
      "if(e)e.userStories.forEach(s=>{s.passes=true;});" +
      "fs.writeFileSync(f,JSON.stringify(p,null,2)+'\\n');" +
      '" "$EPIC_ID" "$PRD_PATH"',
    'fi',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'claude'), mockClaude);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

  fs.writeFileSync(path.join(tempDir, 'prd.json'), JSON.stringify({
    project: 'Unborn Test',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Bootstrap repo',
        status: 'pending',
        userStories: [{ id: 'US-001', title: 'Story', passes: false }],
      },
    ],
  }, null, 2));

  return { tempDir, binDir };
}

test('ralph.sh auto-commits dirty changes without prompting before switching branches', () => {
  const { tempDir, binDir } = setupTempRepo();
  const result = spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Ralph will now stage and commit all current changes before the run\./);
  assert.match(result.stdout, /create or switch to branch 'ralph\/loop\//);
  assert.doesNotMatch(result.stdout, /Proceed with auto-commit before continuing\? \[y\/N\]: /);
  assert.match(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: tempDir, encoding: 'utf-8' }), /chore: auto-commit changes before ralph run/);
  assert.equal(execFileSync('git', ['status', '--short'], { cwd: tempDir, encoding: 'utf-8' }).trim(), '');
});

test('ralph.sh auto-commits dirty changes and continues', () => {
  const { tempDir, binDir } = setupTempRepo();
  const result = spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /Proceed with auto-commit before continuing\? \[y\/N\]: /);
  assert.match(result.stdout, /Creating loop branch: ralph\/loop\//);
  assert.match(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: tempDir, encoding: 'utf-8' }), /chore: auto-commit changes before ralph run/);
  assert.equal(execFileSync('git', ['status', '--short'], { cwd: tempDir, encoding: 'utf-8' }).trim(), '');
  assert.match(execFileSync('git', ['branch', '--show-current'], { cwd: tempDir, encoding: 'utf-8' }).trim(), /^ralph\/loop\//);
});

test('ralph.sh creates an initial commit automatically for an unborn repo', () => {
  const { tempDir, binDir } = setupUnbornRepo();
  const result = spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      RALPH_MAX_CRASH_RETRIES: '0',
    },
    encoding: 'utf-8',
  });

  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(combined, /Repository has no commits yet\. Ralph will create an initial commit before creating worktrees\./);
  assert.doesNotMatch(combined, /invalid reference:/);
  assert.notEqual(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: tempDir, encoding: 'utf-8' }).trim(), '0');
});

test('ralph.sh fails early with the real error when loop branch creation fails', () => {
  const { tempDir, binDir } = setupTempRepo();
  const realGit = execFileSync('which', ['git'], { encoding: 'utf-8' }).trim();
  const mockGit = [
    '#!/bin/sh',
    `REAL_GIT='${realGit}'`,
    'if [ "$1" = "checkout" ] && [ "$2" = "-b" ] && [ "${3#ralph/loop/}" != "$3" ]; then',
    '  echo "fatal: simulated loop branch creation failure" >&2',
    '  exit 1',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'git'), `${mockGit}\n`);
  fs.chmodSync(path.join(binDir, 'git'), 0o755);

  const result = spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
    encoding: 'utf-8',
  });

  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(combined, /Error: failed to create loop branch 'ralph\/loop\//);
  assert.match(combined, /fatal: simulated loop branch creation failure/);
  assert.doesNotMatch(combined, /invalid reference:/);
});

// ─── US-001: Wave Computation Helpers ────────────────────────────────────────

/**
 * Create a temp git repo with a smart mock claude binary.
 * resultMap maps epic ID -> completion string (currently only 'PASS' matters).
 * Epics not in the map make no PRD progress and are treated as failed/crashed by Ralph.
 */
function setupMultiEpicRepo(
  epics: Array<{ id: string; title: string; status?: string; dependsOn?: string[] }>,
  resultMap: Record<string, string> = {},
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-wave-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  // Smart mock claude: reads stdin, extracts epic ID, and updates prd.json story
  // passes via env vars. CWD when invoked is the repo root (tempDir).
  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'if [ -n "$EPIC_ID" ]; then',
    '  ENV_KEY="MOCK_RESULT_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  RESULT_VAL=$(printenv "$ENV_KEY" 2>/dev/null || true)',
    '  HANG_KEY="MOCK_HANG_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  HANG_VAL=$(printenv "$HANG_KEY" 2>/dev/null || true)',
    '  if [ -n "$RESULT_VAL" ]; then',
    '    if [ "$RESULT_VAL" = "PASS" ]; then',
    '      node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[1];" +
      "if (f && fs.existsSync(f)) {" +
      " const s=JSON.parse(fs.readFileSync(f,'utf8'));" +
      " for (const v of Object.values(s.stories||{})) { v.passes=true; v.failureReason=null; }" +
      " const t=f+'.tmp.'+process.pid;" +
      " fs.writeFileSync(t,JSON.stringify(s,null,2)+'\\n');" +
      " fs.renameSync(t,f);" +
      "}" +
      '" "$STATE_PATH"',
    '      node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[2];" +
      "const p=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "const e=p.epics.find(x=>x.id===process.argv[1]);" +
      "if(e)e.userStories.forEach(s=>{s.passes=true;});" +
      "const t=f+'.tmp.'+process.pid;" +
      "fs.writeFileSync(t,JSON.stringify(p,null,2)+'\\n');" +
      "fs.renameSync(t,f);" +
    '" "$EPIC_ID" "$PRD_PATH"',
    '    fi',
    '  fi',
    '  if [ "$HANG_VAL" = "1" ]; then',
    '    sleep 30',
    '  fi',
    'fi',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'claude'), mockClaude);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

  const prd = {
    project: 'Wave Test',
    epics: epics.map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status ?? 'pending',
      ...(e.dependsOn ? { dependsOn: e.dependsOn } : {}),
      userStories: [{ id: 'US-001', title: 'Story', passes: false }],
    })),
  };
  fs.writeFileSync(path.join(tempDir, 'prd.json'), JSON.stringify(prd, null, 2));
  fs.writeFileSync(path.join(tempDir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', '.'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tempDir });

  // Build env with per-epic result values
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    // Disable crash retries so tests fail fast instead of looping
    RALPH_MAX_CRASH_RETRIES: '0',
  };
  for (const [epicId, result] of Object.entries(resultMap)) {
    const envKey = `MOCK_RESULT_${epicId.replace(/-/g, '_')}`;
    env[envKey] = result;
  }

  return { tempDir, binDir, env };
}

function runRalph(tempDir: string, env: Record<string, string>, args: string[] = []) {
  return spawnSync(BASH, [scriptPath, 'prd.json', ...args], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
  });
}

test('codex backend suppresses bare file-path chatter in stdout while keeping outcome lines', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-codex-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  const mockCodex = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'printf "./src/config.ts\\n"',
    'printf "./src/index.ts\\n"',
    'node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[2];" +
      "const p=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "const e=p.epics.find(x=>x.id===process.argv[1]);" +
      "if(e)e.userStories.forEach(s=>{s.passes=true;});" +
      "const t=f+'.tmp.'+process.pid;" +
      "fs.writeFileSync(t,JSON.stringify(p,null,2)+'\\n');" +
      "fs.renameSync(t,f);" +
    '" "$EPIC_ID" "$PRD_PATH"',
    'printf "PASS\\n"',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'codex'), mockCodex);
  fs.chmodSync(path.join(binDir, 'codex'), 0o755);

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

  fs.writeFileSync(path.join(tempDir, 'prd.json'), JSON.stringify({
    project: 'Codex Noise Test',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Alpha',
        status: 'pending',
        userStories: [{ id: 'US-001', title: 'Story', passes: false }],
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(tempDir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', '.'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tempDir });

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    RALPH_MAX_CRASH_RETRIES: '0',
  };

  const result = runRalph(tempDir, env, ['--backend', 'codex']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.doesNotMatch(result.stdout, /\[EPIC-001\]\s+\.\/*src\/config\.ts/);
  assert.doesNotMatch(result.stdout, /\[EPIC-001\]\s+\.\/*src\/index\.ts/);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
});

// ─── US-001 Tests ─────────────────────────────────────────────────────────────

test('US-001: two independent epics run in the same wave', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta' },
    ],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  // Both epics should be counted as remaining for the sequential run
  assert.match(result.stdout, /2 epic\(s\) remaining to run sequentially/);
  assert.doesNotMatch(result.stdout, /Wave 1/);
  assert.doesNotMatch(result.stdout, /Wave 2/);

  // Both should pass
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  assert.match(result.stdout, /\[EPIC-002\] PASSED/);
});

test('US-001: dependent epic runs after its dependency completes', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },
    ],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  // Sequential mode should show the total remaining backlog decreasing
  const remainingMatches = result.stdout.match(/[12] epic\(s\) remaining to run sequentially/g) ?? [];
  assert.equal(remainingMatches.length, 2, `Expected two sequential remaining banners, got stdout: ${result.stdout}`);

  // EPIC-001 should complete before the backlog decreases from 2 to 1 for EPIC-002
  const firstRemainingPos = result.stdout.indexOf('2 epic(s) remaining to run sequentially');
  const secondRemainingPos = result.stdout.indexOf('1 epic(s) remaining to run sequentially');
  const epic1Pos = result.stdout.indexOf('[EPIC-001] PASSED');
  const epic2Pos = result.stdout.indexOf('[EPIC-002] PASSED');
  assert.ok(firstRemainingPos < epic1Pos && epic1Pos < secondRemainingPos, 'EPIC-001 should complete before the remaining count drops to 1');
  assert.ok(secondRemainingPos < epic2Pos, 'EPIC-002 should complete after the remaining count drops to 1');
});

test('US-001: circular dependency detected — exits with code 1', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha', dependsOn: ['EPIC-002'] },
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },
    ],
    {},
  );

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 1, `Expected exit 1 for circular dep`);
  // Error goes to stderr
  const combined = result.stdout + result.stderr;
  assert.match(combined, /[Cc]ircular dependency/);
});

test('US-001: failed dependency causes dependent to be skipped, independent still runs', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },          // will fail (no PRD progress)
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },  // should be skipped
      { id: 'EPIC-003', title: 'Gamma' },           // independent — should pass
    ],
    { 'EPIC-003': 'PASS' },  // EPIC-001 makes no progress → fails; EPIC-002 skipped; EPIC-003 passes
  );

  const result = runRalph(tempDir, env);
  // EPIC-003 should complete even though EPIC-001 failed
  assert.match(result.stdout, /\[EPIC-003\] PASSED/);
  // EPIC-002 should be skipped
  assert.match(result.stdout, /\[EPIC-002\].*[Ss]kipped/);
});

test('US-001: wave boundaries are logged to progress.txt', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },
    ],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );

  // Use --parallel 1 so progress.txt uses "Wave N" section headers
  runRalph(tempDir, env, ['--parallel', '1']);

  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /=== Wave 1 —/);
  assert.match(progress, /=== Wave 2 —/);
  assert.match(progress, /EPIC-001/);
  assert.match(progress, /EPIC-002/);
});

test('US-001: rerunning Ralph automatically retries failed epics', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Retry Me', status: 'failed' },
      { id: 'EPIC-002', title: 'Already Done', status: 'completed' },
    ],
    { 'EPIC-001': 'PASS' },
  );

  const prdPath = path.join(tempDir, 'prd.json');
  const prd = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  prd.epics[0].userStories = [
    { id: 'US-001', title: 'Passed Before', passes: true },
    { id: 'US-002', title: 'Retry This', passes: false },
  ];
  fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2));
  execFileSync('git', ['add', 'prd.json'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'test: seed failed epic for rerun'], { cwd: tempDir });

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] previous status failed — resetting to pending for rerun/);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);

  const after = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  assert.equal(after.epics[0].status, 'completed');
  assert.equal(after.epics[0].userStories[0].passes, true);
  // The mock sets all stories to passes:true when result is PASS; verify epic completed
  assert.equal(after.epics[0].userStories[1].passes, true);
});

// ─── US-002 Tests ─────────────────────────────────────────────────────────────

test('US-002: a loop branch is created for the run and an epic worktree is created per epic', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    { 'EPIC-001': 'PASS' },
  );

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  assert.match(result.stdout, /Creating loop branch: ralph\/loop\//);
  // Ralph should report spawning the epic in a worktree (branch creation is logged)
  assert.match(result.stdout, /Spawning \[EPIC-001\] in worktree/);
  // The epic should complete (confirming the worktree + branch were usable)
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  assert.match(execFileSync('git', ['branch', '--show-current'], { cwd: tempDir, encoding: 'utf-8' }).trim(), /^ralph\/loop\//);
});

test('US-002: worktrees are cleaned up after wave completes', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    { 'EPIC-001': 'PASS' },
  );

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  // .worktrees/EPIC-001 should NOT exist after cleanup
  assert.equal(fs.existsSync(path.join(tempDir, '.ralph-teams', '.worktrees', 'EPIC-001')), false);
});

test('US-002: stale unregistered worktree directory is removed automatically', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    { 'EPIC-001': 'PASS' },
  );

  const stalePath = path.join(tempDir, '.ralph-teams', '.worktrees', 'EPIC-001');
  fs.mkdirSync(stalePath, { recursive: true });
  fs.writeFileSync(path.join(stalePath, 'KEEP.txt'), 'preserve me\n');

  const result = spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
  });

  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(combined, /Found a stale worktree directory/);
  assert.match(combined, /Removing the stale directory so Ralph can recreate the worktree\./);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  assert.equal(fs.existsSync(path.join(stalePath, 'KEEP.txt')), false);
});

test('US-002: a transient worktree creation failure is retried automatically', () => {
  const { tempDir, binDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    { 'EPIC-001': 'PASS' },
  );

  const realGit = execFileSync('which', ['git'], { encoding: 'utf-8' }).trim();
  const stateFile = path.join(tempDir, '.git-worktree-add-failed-once');
  const mockGit = [
    '#!/bin/sh',
    `REAL_GIT='${realGit}'`,
    `STATE_FILE='${stateFile}'`,
    'if [ "$1" = "worktree" ] && [ "$2" = "add" ] && [ "${3#*.ralph-teams/.worktrees/EPIC-001}" != "$3" ]; then',
    '  if [ ! -f "$STATE_FILE" ]; then',
    '    : > "$STATE_FILE"',
    '    echo "fatal: simulated worktree add failure" >&2',
    '    exit 1',
    '  fi',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'git'), `${mockGit}\n`);
  fs.chmodSync(path.join(binDir, 'git'), 0o755);

  const result = runRalph(tempDir, env);
  const combined = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(combined, /Worktree creation for 'ralph\/EPIC-001' failed on the first attempt; pruning stale state and retrying once\./);
  assert.match(combined, /fatal: simulated worktree add failure/);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
});

test('US-002: two independent epics each get separate log files', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta' },
    ],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  assert.ok(fs.existsSync(logsDir), 'logs/ directory should exist');
  const logFiles = fs.readdirSync(logsDir);
  const epic1Logs = logFiles.filter((f) => f.includes('EPIC-001'));
  const epic2Logs = logFiles.filter((f) => f.includes('EPIC-002'));
  assert.ok(epic1Logs.length > 0, 'should have a log file for EPIC-001');
  assert.ok(epic2Logs.length > 0, 'should have a log file for EPIC-002');
});

test('US-002: epics in a wave run in parallel (both finish)', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta' },
      { id: 'EPIC-003', title: 'Gamma' },
    ],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS', 'EPIC-003': 'PASS' },
  );

  // Use --parallel 3 so all three epics are dispatched as a single wave
  const result = runRalph(tempDir, env, ['--parallel', '3']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  // All three should be spawned in Wave 1 (no deps)
  assert.match(result.stdout, /Wave 1 — 3 epic\(s\)/);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  assert.match(result.stdout, /\[EPIC-002\] PASSED/);
  assert.match(result.stdout, /\[EPIC-003\] PASSED/);
});

test('US-002: PRD completion advances even if backend session lingers', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },
    ],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );

  env.MOCK_HANG_EPIC_001 = '1';

  // Use --parallel 2 so we get wave-based scheduling and Wave N output
  const result = spawnSync(BASH, [scriptPath, 'prd.json', '--parallel', '2'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 10000,
  });

  assert.equal(result.error, undefined, `expected Ralph to finish before timeout; got ${result.error}`);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  assert.match(result.stdout, /Wave 2 — 1 epic\(s\)/);
  assert.match(result.stdout, /\[EPIC-002\] PASSED/);
});

// ─── US-003 Tests ─────────────────────────────────────────────────────────────

test('US-003: --parallel flag is parsed and shown in banner', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    { 'EPIC-001': 'PASS' },
  );

  const result = runRalph(tempDir, env, ['--parallel', '2']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /Parallel: 2/);
});

test('US-003: default (no --parallel) stays sequential', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    { 'EPIC-001': 'PASS' },
  );

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /Mode: sequential/);
  assert.doesNotMatch(result.stdout, /Parallel:/);
});

test('US-003: --parallel 1 runs all epics in wave sequentially and all pass', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta' },
      { id: 'EPIC-003', title: 'Gamma' },
    ],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS', 'EPIC-003': 'PASS' },
  );

  const result = runRalph(tempDir, env, ['--parallel', '1']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  // All three should still complete
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  assert.match(result.stdout, /\[EPIC-002\] PASSED/);
  assert.match(result.stdout, /\[EPIC-003\] PASSED/);
});

// ─── US-004 Tests ─────────────────────────────────────────────────────────────

/**
 * Sets up a repo where epic branches have actual commits (different files),
 * so they can be cleanly merged back to main. Uses a mock claude that creates
 * a commit on the epic branch and updates PRD story passes before reporting.
 */
function setupMergeRepo(
  epics: Array<{ id: string; title: string; fileName: string }>,
  options?: { dirtyLoopBranchBeforeMerge?: boolean },
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-merge-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);
  const dirtyLoopBranchBeforeMerge = options?.dirtyLoopBranchBeforeMerge === true;

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

  // Initial commit on main
  fs.writeFileSync(path.join(tempDir, 'README.md'), 'initial\n');
  const prd = {
    project: 'Merge Test',
    epics: epics.map((e) => ({
      id: e.id,
      title: e.title,
      status: 'pending',
      userStories: [{ id: 'US-001', title: 'Story', passes: false }],
    })),
  };
  fs.writeFileSync(path.join(tempDir, 'prd.json'), JSON.stringify(prd, null, 2));
  execFileSync('git', ['add', '.'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tempDir });

  // Mock claude: creates a unique file on the epic branch and updates prd.json
  // story passes so process_epic_result() marks it completed.
  const mockClaude = [
    '#!/bin/sh',
    `DIRTY_LOOP_BEFORE_MERGE="${dirtyLoopBranchBeforeMerge ? '1' : '0'}"`,
    'STDIN=$(cat)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'if [ -n "$EPIC_ID" ]; then',
    '  ENV_KEY="MOCK_FILE_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  FILE_NAME=$(printenv "$ENV_KEY" 2>/dev/null || true)',
    '  if [ -n "$FILE_NAME" ]; then',
    '    printf "content for %s\\n" "$EPIC_ID" > "$FILE_NAME"',
    '    git add "$FILE_NAME"',
    '    git commit -m "feat: add $FILE_NAME for $EPIC_ID"',
    '  fi',
    '  if [ "$DIRTY_LOOP_BEFORE_MERGE" = "1" ]; then',
    '    MAIN_ROOT=$(git worktree list --porcelain | awk \'/^worktree / {print $2; exit}\')',
    '    if [ -n "$MAIN_ROOT" ] && [ -f "$MAIN_ROOT/prd.json" ]; then',
    '      node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[1];" +
      "const p=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "p.project=String(p.project)+' dirty';" +
      "const t=f+'.tmp.'+process.pid;" +
      "fs.writeFileSync(t,JSON.stringify(p,null,2)+'\\n');" +
      "fs.renameSync(t,f);" +
      '" "$MAIN_ROOT/prd.json"',
    '    fi',
    '  fi',
    '  node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[1];" +
      "if (f && fs.existsSync(f)) {" +
      " const s=JSON.parse(fs.readFileSync(f,'utf8'));" +
      " for (const v of Object.values(s.stories||{})) { v.passes=true; v.failureReason=null; }" +
      " const t=f+'.tmp.'+process.pid;" +
      " fs.writeFileSync(t,JSON.stringify(s,null,2)+'\\n');" +
      " fs.renameSync(t,f);" +
      "}" +
    '" "$STATE_PATH"',
    '  node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[2];" +
      "const p=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "const e=p.epics.find(x=>x.id===process.argv[1]);" +
      "if(e)e.userStories.forEach(s=>{s.passes=true;});" +
      "const t=f+'.tmp.'+process.pid;" +
      "fs.writeFileSync(t,JSON.stringify(p,null,2)+'\\n');" +
      "fs.renameSync(t,f);" +
    '" "$EPIC_ID" "$PRD_PATH"',
    'fi',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'claude'), mockClaude);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    RALPH_MAX_CRASH_RETRIES: '0',
  };
  // Tell the mock which file to create per epic
  for (const e of epics) {
    const envKey = `MOCK_FILE_${e.id.replace(/-/g, '_')}`;
    env[envKey] = e.fileName;
  }

  return { tempDir, binDir, env };
}

test('US-004: merge is attempted after wave completes — progress.txt contains merge entry', () => {
  const { tempDir, env } = setupMergeRepo([
    { id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' },
  ]);

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] MERGED/);
});

test('US-004: epic success is preserved when only the worktree PRD is updated', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-worktree-prd-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

  const prd = {
    project: 'Worktree PRD Test',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Alpha',
        status: 'pending',
        userStories: [{ id: 'US-001', title: 'Story', passes: false }],
      },
    ],
  };
  fs.writeFileSync(path.join(tempDir, 'prd.json'), JSON.stringify(prd, null, 2));
  fs.writeFileSync(path.join(tempDir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', '.'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tempDir });

  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'WORKTREE=$(printf "%s" "$STDIN" | awk \'/ALL work for this epic MUST happen in this directory:/ {sub(/^.*directory: /, ""); print; exit}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'cd "$WORKTREE" || exit 1',
    'node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[1];" +
      "const epicId=process.argv[2];" +
      "const p=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "const e=p.epics.find(x=>x.id===epicId);" +
      "if(e)e.userStories.forEach(s=>{s.passes=true;});" +
      "const t=f+'.tmp.'+process.pid;" +
      "fs.writeFileSync(t,JSON.stringify(p,null,2)+'\\n');" +
      "fs.renameSync(t,f);" +
    '" "$PRD_PATH" "$EPIC_ID"',
    'git add prd.json',
    'git commit -m "feat: mark story passed in worktree PRD"',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'claude'), mockClaude);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    RALPH_MAX_CRASH_RETRIES: '0',
  };

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);

  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] MERGED/);

  const finalPrd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8')) as {
    epics: Array<{ status: string; userStories: Array<{ passes: boolean }> }>;
  };
  assert.equal(finalPrd.epics[0]?.status, 'completed');
  assert.equal(finalPrd.epics[0]?.userStories[0]?.passes, true);
});

test('ralph.sh auto-adds runtime artifacts to the repo .gitignore', () => {
  const { tempDir, env } = setupMergeRepo([
    { id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' },
  ]);

  const result = spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    input: 'y\n',
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /Updated \.gitignore with Ralph runtime directory/);

  const gitignore = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8');
  assert.match(gitignore, /^\.ralph-teams\/$/m);
});

test('US-004: clean merge succeeds without spawning merger agent', () => {
  const { tempDir, env } = setupMergeRepo([
    { id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' },
  ]);

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  // Should report clean merge in stdout
  assert.match(result.stdout, /\[EPIC-001\] Merge successful \(clean\)/);

  // No merger agent log should exist (clean merge doesn't spawn agent)
  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  if (fs.existsSync(logsDir)) {
    const mergeLogs = fs.readdirSync(logsDir).filter((f) => f.startsWith('merge-'));
    assert.equal(mergeLogs.length, 0, 'clean merge should not create a merge agent log');
  }
});

test('US-004: dirty loop branch is auto-committed before merge', () => {
  const { tempDir, env } = setupMergeRepo([
    { id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' },
  ], { dirtyLoopBranchBeforeMerge: true });

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] Auto-committed dirty worktree before merge/);
  assert.match(result.stdout, /\[EPIC-001\] Merge successful \(clean\)/);

  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] AUTO-COMMIT before merge wave/);

  const subjects = execFileSync('git', ['log', '--pretty=%s', '-n', '5'], { cwd: tempDir, encoding: 'utf-8' });
  assert.match(subjects, /chore: checkpoint loop branch before merge wave/);
});

test('US-004: epic branch is deleted after successful merge', () => {
  const { tempDir, env } = setupMergeRepo([
    { id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' },
  ]);

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  // Branch ralph/EPIC-001 should be deleted after merge
  const branches = execFileSync('git', ['branch'], { cwd: tempDir, encoding: 'utf-8' });
  assert.doesNotMatch(branches, /ralph\/EPIC-001/, 'epic branch should be deleted after merge');
});

test('US-004: two independent epics both merge cleanly after wave', () => {
  const { tempDir, env } = setupMergeRepo([
    { id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' },
    { id: 'EPIC-002', title: 'Beta', fileName: 'beta.txt' },
  ]);

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] MERGED/);
  assert.match(progress, /\[EPIC-002\] MERGED/);

  // Both branches should be cleaned up
  const branches = execFileSync('git', ['branch'], { cwd: tempDir, encoding: 'utf-8' });
  assert.doesNotMatch(branches, /ralph\/EPIC-001/);
  assert.doesNotMatch(branches, /ralph\/EPIC-002/);
});

// ─── US-005 Tests ─────────────────────────────────────────────────────────────

/**
 * Sets up a repo with a merge conflict scenario:
 * - Initial commit has README.md with "line one"
 * - The mock claude (as team-lead) modifies README.md in the worktree (epic branch)
 *   AND also commits a conflicting change to main using git -C to the root repo
 * - When merge_wave runs, the merge will conflict on README.md
 * - The mock claude (when called as merger agent) exits 0 without resolving conflicts
 * - This simulates a failed AI merge resolution
 */
function setupConflictRepo(options?: { resolveWithMerger?: boolean }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-conflict-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);
  const resolveWithMerger = options?.resolveWithMerger === true;

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

  // Initial commit
  fs.writeFileSync(path.join(tempDir, 'README.md'), 'line one\n');
  const prd = {
    project: 'Conflict Test',
    epics: [
      {
        id: 'EPIC-001',
        title: 'Conflict Epic',
        status: 'pending',
        userStories: [{ id: 'US-001', title: 'Story', passes: false }],
      },
    ],
  };
  fs.writeFileSync(path.join(tempDir, 'prd.json'), JSON.stringify(prd, null, 2));
  execFileSync('git', ['add', '.'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tempDir });

  // Mock claude: when acting as team-lead, modifies README.md in the worktree
  // AND creates a conflicting commit on main. When acting as merger agent, either
  // resolves the conflict or exits without doing so depending on options.
  // prd.json is updated so EPIC-001 is marked completed.
  const mockClaude = [
    '#!/bin/sh',
    `RESOLVE_WITH_MERGER="${resolveWithMerger ? '1' : '0'}"`,
    'STDIN=$(cat)',
    'ARGS="$*"',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    '# Only act as team-lead (prompt contains Working Directory)',
    'WORKTREE=$(printf "%s" "$STDIN" | grep -oE "[^ ]*\\.worktrees/[^ ]*" | head -1)',
    'if [ -n "$EPIC_ID" ] && [ -n "$WORKTREE" ] && [ -d "$WORKTREE" ]; then',
    '  # Write conflicting content in the worktree (epic branch)',
    '  printf "epic version\\n" > "$WORKTREE/README.md"',
    '  git -C "$WORKTREE" add README.md',
    '  git -C "$WORKTREE" commit -m "feat: epic change to README"',
    '  # Also advance main with a conflicting change (creates divergence)',
    '  ROOT=$(git -C "$WORKTREE" rev-parse --show-toplevel 2>/dev/null || true)',
    '  # ROOT points to the worktree; find the main repo via git worktree list',
    '  MAIN_ROOT=$(git -C "$WORKTREE" worktree list --porcelain | grep "^worktree" | head -1 | awk "{print \\$2}")',
    '  if [ -n "$MAIN_ROOT" ] && [ -d "$MAIN_ROOT" ]; then',
    '    printf "main version\\n" > "$MAIN_ROOT/README.md"',
    '    git -C "$MAIN_ROOT" add README.md',
    '    git -C "$MAIN_ROOT" -c user.name="Ralph Test" -c user.email="ralph@example.com" commit -m "chore: main change to README"',
    '  fi',
    '  node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[2];" +
      "const p=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "const e=p.epics.find(x=>x.id===process.argv[1]);" +
      "if(e)e.userStories.forEach(s=>{s.passes=true;});" +
      "const t=f+'.tmp.'+process.pid;" +
      "fs.writeFileSync(t,JSON.stringify(p,null,2)+'\\n');" +
      "fs.renameSync(t,f);" +
    '" "$EPIC_ID" "$PRD_PATH"',
    '  exit 0',
    'fi',
    '# When called as merger agent, optionally resolve the conflict in the repo root',
    'if printf "%s" "$ARGS" | grep -q -- "--agent merger"; then',
    '  touch merger-agent-invoked.txt',
    '  if [ "$RESOLVE_WITH_MERGER" = "1" ]; then',
    '    printf "main version\\nepic version\\n" > README.md',
    '    git add README.md',
    '    echo MERGE_SUCCESS',
    '    exit 0',
    '  fi',
    'fi',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'claude'), mockClaude);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    RALPH_MAX_CRASH_RETRIES: '0',
  };

  return { tempDir, binDir, env };
}

test('US-005: merge-failed status set when conflict cannot be resolved', () => {
  const { tempDir, env } = setupConflictRepo();

  // Run ralph — EPIC-001 is already completed, so it goes straight to merge_wave
  // The mock claude won't resolve conflicts, so merge should fail
  runRalph(tempDir, env);

  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  assert.equal(prd.epics[0].status, 'merge-failed', `Expected merge-failed, got: ${prd.epics[0].status}`);
});

test('US-005: conflict resolution attempt is logged to progress.txt', () => {
  const { tempDir, env } = setupConflictRepo();

  runRalph(tempDir, env);

  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] merge conflicts/);
  assert.match(progress, /\[EPIC-001\] MERGE FAILED/);
});

test('US-005: merge-failed epic does not block independent epics in later waves', () => {
  // EPIC-001 is merge-failed (pre-set), EPIC-002 depends on it (should skip),
  // EPIC-003 is independent (should run)
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha', status: 'merge-failed' },
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },
      { id: 'EPIC-003', title: 'Gamma' },
    ],
    { 'EPIC-003': 'PASS' },
  );

  const result = runRalph(tempDir, env);

  // EPIC-003 should run and pass
  assert.match(result.stdout, /\[EPIC-003\] PASSED/);
  // EPIC-002 should be skipped due to EPIC-001 being merge-failed
  assert.match(result.stdout, /\[EPIC-002\].*[Ss]kipped/);
});

test('US-005: merge log file created when merger agent is spawned', () => {
  const { tempDir, env } = setupConflictRepo();

  runRalph(tempDir, env);

  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  assert.ok(fs.existsSync(logsDir), 'logs/ directory should exist');
  const mergeLogs = fs.readdirSync(logsDir).filter((f) => f.startsWith('merge-EPIC-001'));
  assert.ok(mergeLogs.length > 0, 'merge log file should be created when agent is spawned');
});

test('US-005: merger agent is spawned and can resolve a simple conflict end to end', () => {
  const { tempDir, env } = setupConflictRepo({ resolveWithMerger: true });

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] merged \(AI-resolved conflicts\)/);

  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  assert.equal(prd.epics[0].status, 'completed');

  assert.ok(
    fs.existsSync(path.join(tempDir, 'merger-agent-invoked.txt')),
    'expected merger agent marker file to prove the merger agent process ran',
  );

  const readme = fs.readFileSync(path.join(tempDir, 'README.md'), 'utf-8');
  assert.equal(readme, 'main version\nepic version\n');

  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  const mergeLogs = fs.readdirSync(logsDir).filter((f) => f.startsWith('merge-EPIC-001'));
  assert.ok(mergeLogs.length > 0, 'merge log file should exist for AI-resolved merge');

  const mergeLog = fs.readFileSync(path.join(logsDir, mergeLogs[0]), 'utf-8');
  assert.match(mergeLog, /MERGE_SUCCESS/);
});

test('US-003: --max-epics with --parallel both respected', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta' },
      { id: 'EPIC-003', title: 'Gamma' },
      { id: 'EPIC-004', title: 'Delta' },
      { id: 'EPIC-005', title: 'Epsilon' },
    ],
    {
      'EPIC-001': 'PASS',
      'EPIC-002': 'PASS',
      'EPIC-003': 'PASS',
      'EPIC-004': 'PASS',
      'EPIC-005': 'PASS',
    },
  );

  // 5 independent epics, parallel=2, max-epics=3 — only 3 should be processed
  const result = runRalph(tempDir, env, ['--parallel', '2', '--max-epics', '3']);
  // Should stop after 3 processed regardless of wave size
  const passedCount = (result.stdout.match(/PASSED/g) ?? []).length;
  assert.ok(passedCount <= 3, `Expected at most 3 PASSEDs, got ${passedCount}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /Reached max epics limit/);
});

// ─── US-008 Tests (Graceful shutdown on ctrl+c) ───────────────────────────────

/**
 * Helper: run ralph.sh with spawn (non-blocking), wait until the process has
 * written its worktree path to stdout (meaning it's past validation and into
 * the wave loop), then send SIGINT. Returns a Promise that resolves to
 * { stdout, stderr, code } when the process exits.
 */
function runRalphWithSigint(
  tempDir: string,
  env: Record<string, string>,
  args: string[] = [],
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(BASH, [scriptPath, 'prd.json', ...args], {
      cwd: tempDir,
      env,
    });

    let stdout = '';
    let stderr = '';
    let sigintSent = false;

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`ralph.sh timed out after ${timeoutMs}ms. stdout so far:\n${stdout}`));
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      // Send SIGINT once the process is past validation and into the wave loop
      // (detected by "Spawning" appearing in output, meaning agents are active)
      if (!sigintSent && stdout.includes('Spawning')) {
        sigintSent = true;
        // Small delay to let the agent process start
        setTimeout(() => proc.kill('SIGINT'), 200);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test('US-008: SIGINT writes ralph-state.json with expected fields', { timeout: 15000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},  // No result — so the mock hangs
  );
  // Make the mock agent hang so we can send SIGINT
  env['MOCK_HANG_EPIC_001'] = '1';

  await runRalphWithSigint(tempDir, env);

  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  assert.ok(fs.existsSync(stateFile), 'ralph-state.json should exist after SIGINT');

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
  assert.equal(state['version'], 1, 'state.version should be 1');
  assert.ok(typeof state['prdFile'] === 'string', 'state.prdFile should be a string');
  assert.ok(typeof state['currentWave'] === 'number', 'state.currentWave should be a number');
  assert.ok(Array.isArray(state['activeEpics']), 'state.activeEpics should be an array');
  assert.ok(typeof state['backend'] === 'string', 'state.backend should be a string');
  assert.ok(typeof state['timestamp'] === 'string', 'state.timestamp should be a string');
});

test('US-008: SIGINT prints resume message', { timeout: 15000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},
  );
  env['MOCK_HANG_EPIC_001'] = '1';

  const { stdout } = await runRalphWithSigint(tempDir, env);
  assert.match(stdout, /Run interrupted\. Resume with: ralph-teams resume/);
});

test('US-008: SIGINT exits with code 130', { timeout: 15000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},
  );
  env['MOCK_HANG_EPIC_001'] = '1';

  const { code } = await runRalphWithSigint(tempDir, env);
  assert.equal(code, 130, 'should exit with code 130 on SIGINT');
});

test('US-008: worktrees are preserved after SIGINT (not cleaned up)', { timeout: 15000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},
  );
  env['MOCK_HANG_EPIC_001'] = '1';

  await runRalphWithSigint(tempDir, env);

  // Worktree should still exist (not cleaned up so resume is possible)
  const worktreeDir = path.join(tempDir, '.ralph-teams', '.worktrees', 'EPIC-001');
  assert.ok(fs.existsSync(worktreeDir), 'worktree should be preserved after SIGINT');
});

test('US-008: ralph-state.json includes the active epic ID', { timeout: 15000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},
  );
  env['MOCK_HANG_EPIC_001'] = '1';

  await runRalphWithSigint(tempDir, env);

  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
  const activeEpics = state['activeEpics'] as string[];
  assert.ok(activeEpics.includes('EPIC-001'), `activeEpics should include EPIC-001, got: ${JSON.stringify(activeEpics)}`);
});

test('US-008: ralph-state.json includes storyProgress field', { timeout: 15000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},
  );
  env['MOCK_HANG_EPIC_001'] = '1';

  await runRalphWithSigint(tempDir, env);

  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;

  assert.ok('storyProgress' in state, 'state should have storyProgress field');
  assert.ok(typeof state['storyProgress'] === 'object' && state['storyProgress'] !== null,
    `storyProgress should be an object, got: ${JSON.stringify(state['storyProgress'])}`);

  // The PRD has EPIC-001 with US-001 — verify it appears in storyProgress
  const storyProgress = state['storyProgress'] as Record<string, unknown>;
  assert.ok('EPIC-001' in storyProgress, `storyProgress should contain EPIC-001, got keys: ${Object.keys(storyProgress).join(', ')}`);
  const epicStories = storyProgress['EPIC-001'] as Record<string, unknown>;
  assert.ok('US-001' in epicStories, `EPIC-001 stories should contain US-001, got keys: ${Object.keys(epicStories).join(', ')}`);
});

test('US-008: ralph-state.json includes interruptedStoryId field', { timeout: 15000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},
  );
  env['MOCK_HANG_EPIC_001'] = '1';

  await runRalphWithSigint(tempDir, env);

  const stateFile = path.join(tempDir, '.ralph-teams', 'ralph-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;

  // interruptedStoryId must exist as a key (value may be null since ralph.sh doesn't
  // track individual story execution — the team-lead agent does that internally)
  assert.ok('interruptedStoryId' in state,
    `state should have interruptedStoryId field, got keys: ${Object.keys(state).join(', ')}`);
});

// ─── US-004 (Epic Timeout) Tests ──────────────────────────────────────────────

test('US-004 (timeout): epic is killed and marked failed after RALPH_EPIC_TIMEOUT seconds', { timeout: 15000 }, () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},  // No PRD progress — mock will hang
  );
  // Make mock agent hang (sleep 30) and set a very short timeout (2s)
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_EPIC_TIMEOUT'] = '2';

  const start = Date.now();
  const result = spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });
  const elapsed = Date.now() - start;

  // Should finish well before the 30s mock hang (killed by timeout after ~2s)
  assert.ok(elapsed < 10000, `Expected to finish quickly after timeout, took ${elapsed}ms`);

  // Epic should be marked as failed in PRD
  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  assert.equal(prd.epics[0].status, 'failed', `Expected failed status, got: ${prd.epics[0].status}`);

  // TIMED OUT message should appear in stdout
  assert.match(result.stdout, /\[EPIC-001\] TIMED OUT after 2s/);
});

test('US-004 (timeout): timeout event is logged to progress.txt', { timeout: 15000 }, () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},
  );
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_EPIC_TIMEOUT'] = '2';

  spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });

  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] FAILED \(epic timeout after 2s\)/);
});

test('US-004 (timeout): timed-out epic log file contains timeout message', { timeout: 15000 }, () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},
  );
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_EPIC_TIMEOUT'] = '2';

  spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });

  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  assert.ok(fs.existsSync(logsDir), 'logs/ directory should exist');
  const logFiles = fs.readdirSync(logsDir).filter((f) => f.includes('EPIC-001'));
  assert.ok(logFiles.length > 0, 'should have a log file for EPIC-001');

  const logContent = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf-8');
  assert.match(logContent, /TIMEOUT: Epic exceeded 2s limit/);
});

test('US-004 (timeout): with two independent epics, one times out and the other completes', { timeout: 15000 }, () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta' },
    ],
    { 'EPIC-002': 'PASS' },
  );
  // EPIC-001 hangs, EPIC-002 completes normally; short timeout
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_EPIC_TIMEOUT'] = '2';

  const result = spawnSync(BASH, [scriptPath, 'prd.json', '--parallel', '2'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });

  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  const epic1Status = prd.epics.find((e: { id: string }) => e.id === 'EPIC-001').status;
  const epic2Status = prd.epics.find((e: { id: string }) => e.id === 'EPIC-002').status;

  assert.equal(epic1Status, 'failed', `EPIC-001 should be failed (timed out), got: ${epic1Status}`);
  assert.equal(epic2Status, 'completed', `EPIC-002 should be completed, got: ${epic2Status}\nstdout: ${result.stdout}`);
});

// ─── US-005 (Idle Timeout) Tests ──────────────────────────────────────────────

/**
 * Helper: sets up a repo where the mock claude agent sleeps without writing
 * any output to the log file. This simulates an agent that is stuck/idle.
 * Use MOCK_SILENT_<EPIC_ID> env var to make the mock sleep silently.
 */
function setupIdleTimeoutRepo(
  epics: Array<{ id: string; title: string }>,
  resultMap: Record<string, string> = {},
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-idle-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  // Mock claude: if MOCK_SILENT_<EPIC_ID> is set, sleep 30 without writing any output.
  // Otherwise, if MOCK_RESULT_<EPIC_ID> is set, update prd.json.
  // The key difference from setupMultiEpicRepo: silent mode writes nothing to stdout,
  // so the log file has no output (simulating an idle/stuck agent).
  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'if [ -n "$EPIC_ID" ]; then',
    '  SILENT_KEY="MOCK_SILENT_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  SILENT_VAL=$(printenv "$SILENT_KEY" 2>/dev/null || true)',
    '  RESULT_KEY="MOCK_RESULT_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  RESULT_VAL=$(printenv "$RESULT_KEY" 2>/dev/null || true)',
    '  if [ "$SILENT_VAL" = "1" ]; then',
    '    # Sleep without writing any output — simulates idle/stuck agent',
    '    sleep 30',
    '  elif [ -n "$RESULT_VAL" ]; then',
    '    if [ "$RESULT_VAL" = "PASS" ]; then',
    '      node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[2];" +
      "const p=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "const e=p.epics.find(x=>x.id===process.argv[1]);" +
      "if(e)e.userStories.forEach(s=>{s.passes=true;});" +
      "const t=f+'.tmp.'+process.pid;" +
      "fs.writeFileSync(t,JSON.stringify(p,null,2)+'\\n');" +
      "fs.renameSync(t,f);" +
    '" "$EPIC_ID" "$PRD_PATH"',
    '    fi',
    '  fi',
    'fi',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'claude'), mockClaude);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

  const prd = {
    project: 'Idle Timeout Test',
    epics: epics.map((e) => ({
      id: e.id,
      title: e.title,
      status: 'pending',
      userStories: [{ id: 'US-001', title: 'Story', passes: false }],
    })),
  };
  fs.writeFileSync(path.join(tempDir, 'prd.json'), JSON.stringify(prd, null, 2));
  fs.writeFileSync(path.join(tempDir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', '.'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tempDir });

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    RALPH_MAX_CRASH_RETRIES: '0',
  };
  for (const [epicId, result] of Object.entries(resultMap)) {
    const envKey = `MOCK_RESULT_${epicId.replace(/-/g, '_')}`;
    env[envKey] = result;
  }

  return { tempDir, binDir, env };
}

test('US-005 (idle timeout): idle epic is killed and marked failed after RALPH_IDLE_TIMEOUT seconds', { timeout: 15000 }, () => {
  const { tempDir, env } = setupIdleTimeoutRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
  );
  // Make mock agent sleep silently (no output) — triggers idle timeout
  env['MOCK_SILENT_EPIC_001'] = '1';
  env['RALPH_IDLE_TIMEOUT'] = '2';

  const start = Date.now();
  const result = spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });
  const elapsed = Date.now() - start;

  // Should finish well before the 30s mock hang (killed by idle timeout after ~2s)
  assert.ok(elapsed < 10000, `Expected to finish quickly after idle timeout, took ${elapsed}ms`);

  // Epic should be marked as failed in PRD
  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  assert.equal(prd.epics[0].status, 'failed', `Expected failed status, got: ${prd.epics[0].status}`);

  // IDLE TIMEOUT message should appear in stdout
  assert.match(result.stdout, /\[EPIC-001\] IDLE TIMEOUT — no output for 2s/);
});

test('US-005 (idle timeout): GNU stat -f output does not break log mtime parsing', { timeout: 15000 }, () => {
  const { tempDir, binDir, env } = setupIdleTimeoutRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
  );
  env['MOCK_SILENT_EPIC_001'] = '1';
  env['RALPH_IDLE_TIMEOUT'] = '2';

  const mockStat = [
    '#!/bin/sh',
    'if [ "$1" = "-f" ] && [ "$2" = "%m" ]; then',
    '  echo "File: \\"$3\\""',
    '  echo "ID: deadbeef Namelen: 255 Type: ext2/ext3"',
    '  exit 0',
    'fi',
    'exec /usr/bin/stat "$@"',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'stat'), mockStat);
  fs.chmodSync(path.join(binDir, 'stat'), 0o755);

  const result = spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });

  assert.notEqual(result.status, null, 'Expected script process to exit');
  assert.doesNotMatch(result.stderr, /integer expression expected|unbound variable/);

  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  assert.equal(prd.epics[0].status, 'failed', `Expected failed status, got: ${prd.epics[0].status}`);
});

test('US-005 (idle timeout): idle timeout event is logged to progress.txt', { timeout: 15000 }, () => {
  const { tempDir, env } = setupIdleTimeoutRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
  );
  env['MOCK_SILENT_EPIC_001'] = '1';
  env['RALPH_IDLE_TIMEOUT'] = '2';

  spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });

  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] FAILED \(idle timeout — no output for 2s\)/);
});

test('US-005 (idle timeout): with two epics, only idle one is killed while active one completes', { timeout: 15000 }, () => {
  const { tempDir, env } = setupIdleTimeoutRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta' },
    ],
    { 'EPIC-002': 'PASS' },
  );
  // EPIC-001 is silent (idle), EPIC-002 writes output and completes
  env['MOCK_SILENT_EPIC_001'] = '1';
  env['RALPH_IDLE_TIMEOUT'] = '2';

  const result = spawnSync(BASH, [scriptPath, 'prd.json', '--parallel', '2'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });

  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  const epic1Status = prd.epics.find((e: { id: string }) => e.id === 'EPIC-001').status;
  const epic2Status = prd.epics.find((e: { id: string }) => e.id === 'EPIC-002').status;

  assert.equal(epic1Status, 'failed', `EPIC-001 should be failed (idle timeout), got: ${epic1Status}`);
  assert.equal(epic2Status, 'completed', `EPIC-002 should be completed, got: ${epic2Status}\nstdout: ${result.stdout}`);
});
