import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const scriptPath = path.join(repoRoot, 'ralph.sh');

// ralph.sh requires bash 4+ (uses declare -A). On macOS the system /bin/bash is 3.2,
// so we use the Homebrew bash 5 if available, otherwise fall back to PATH resolution.
export const BASH = fs.existsSync('/opt/homebrew/bin/bash') ? '/opt/homebrew/bin/bash' : 'bash';

process.env.RALPH_POLL_INTERVAL_SECONDS ??= '0.05';

export function readMarkdownPromptBody(relativePath: string): string {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
  return content.replace(/^---\n[\s\S]*?\n---\n\n(?:<!--.*?-->\n\n)?/, '').trim();
}

export function readCodexPromptBody(relativePath: string): string {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
  const match = content.match(/developer_instructions = """\n([\s\S]*?)\n"""/);
  assert.ok(match, `${relativePath} should contain developer_instructions`);
  return match[1].trim();
}

function cloneProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export function createTestEnv(binDir: string): Record<string, string> {
  const env = cloneProcessEnv();
  env.PATH = `${binDir}:${env.PATH ?? ''}`;
  env.RALPH_MAX_CRASH_RETRIES = '0';
  env.RALPH_PARALLEL = '';
  delete env.RALPH_RJQ_BIN;
  env.RALPH_SKIP_RUNTIME_RJQ = '1';
  return env;
}

export function getSingleLoopBranch(repoDir: string): string {
  const branches = execFileSync('git', ['branch', '--format=%(refname:short)', '--list', 'ralph/loop/*'], {
    cwd: repoDir,
    encoding: 'utf-8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  assert.equal(branches.length, 1, `expected exactly one loop branch in ${repoDir}, got ${branches.join(', ') || '<none>'}`);
  return branches[0];
}

export function readFileFromLoopBranch(repoDir: string, relativePath: string): string {
  const branch = getSingleLoopBranch(repoDir);
  return execFileSync('git', ['show', `${branch}:${relativePath}`], {
    cwd: repoDir,
    encoding: 'utf-8',
  });
}

export function readLoopBranchPrd(repoDir: string) {
  return JSON.parse(readFileFromLoopBranch(repoDir, 'prd.json')) as Record<string, unknown>;
}

export function writeSampleJson(targetDir: string, value = 'sample-value') {
  fs.writeFileSync(path.join(targetDir, 'sample.json'), JSON.stringify({ value }, null, 2) + '\n');
}

export function setupTempRepo() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-shell-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  fs.writeFileSync(path.join(binDir, 'claude'), '#!/bin/sh\nprintf "VERDICT: PASS\\n"\n');
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

export function setupUnbornRepo() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-unborn-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'TEAM_LEAD_OWNS_MERGE=$(printf "%s" "$STDIN" | grep -c "this Team Lead session owns the merge" || true)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'LOOP_BRANCH=$(printf "%s" "$STDIN" | sed -n \'s/^- Loop branch to merge into: //p\' | head -1)',
    'ROOT_DIR=$(printf "%s" "$STDIN" | sed -n \'s/^- Repository root for the merge attempt: //p\' | head -1)',
    'MERGE_RESULT_PATH=$(printf "%s" "$STDIN" | sed -n \'s/^- Write the final merge result artifact to: //p\' | head -1)',
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
    '  if [ "$TEAM_LEAD_OWNS_MERGE" != "0" ] && [ -n "$LOOP_BRANCH" ] && [ -n "$ROOT_DIR" ] && [ -n "$MERGE_RESULT_PATH" ]; then',
    '    EPIC_BRANCH=$(git branch --show-current)',
    '    git -C "$ROOT_DIR" checkout "$LOOP_BRANCH"',
    '    if git -C "$ROOT_DIR" merge "$EPIC_BRANCH" --no-commit --no-ff; then',
    '      if [ -f "$ROOT_DIR/.git/MERGE_HEAD" ]; then',
    '        git -C "$ROOT_DIR" commit --no-edit',
    '      fi',
    '      node -e "' +
      "const fs=require('fs');" +
      "const file=process.argv[1];" +
      "const t=file+'.tmp.'+process.pid;" +
      "const data={epicId:process.argv[2],status:'merged',mode:'clean',details:'',timestamp:'2026-03-20T17:30:00+01:00'};" +
      "fs.writeFileSync(t,JSON.stringify(data,null,2)+'\\n');" +
      "fs.renameSync(t,file);" +
      '" "$MERGE_RESULT_PATH" "$EPIC_ID"',
    '    fi',
    '  fi',
    'else',
    '  printf "VERDICT: PASS\\n"',
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

export function setupMultiEpicRepo(
  epics: Array<{ id: string; title: string; status?: string; dependsOn?: string[] }>,
  resultMap: Record<string, string> = {},
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-wave-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'TEAM_LEAD_OWNS_MERGE=$(printf "%s" "$STDIN" | grep -c "this Team Lead session owns the merge" || true)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'LOOP_BRANCH=$(printf "%s" "$STDIN" | sed -n \'s/^- Loop branch to merge into: //p\' | head -1)',
    'ROOT_DIR=$(printf "%s" "$STDIN" | sed -n \'s/^- Repository root for the merge attempt: //p\' | head -1)',
    'MERGE_RESULT_PATH=$(printf "%s" "$STDIN" | sed -n \'s/^- Write the final merge result artifact to: //p\' | head -1)',
    'FINAL_RESULT_PATH=$(printf "%s" "$STDIN" | grep -oE \'[^[:space:]]*final-validation-result[^[:space:]]*\\.json\' | head -1)',
    'if [ -z "$FINAL_RESULT_PATH" ]; then FINAL_RESULT_PATH="$(pwd)/.ralph-teams/state/final-validation-result-mock.json"; fi',
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
    '      EPIC_BRANCH=$(git branch --show-current)',
    '      if [ "$TEAM_LEAD_OWNS_MERGE" != "0" ] && [ -n "$LOOP_BRANCH" ] && [ -n "$ROOT_DIR" ] && [ -n "$MERGE_RESULT_PATH" ]; then',
    '        git -C "$ROOT_DIR" checkout "$LOOP_BRANCH"',
    '        if git -C "$ROOT_DIR" merge "$EPIC_BRANCH" --no-commit --no-ff; then',
    '          if [ -f "$ROOT_DIR/.git/MERGE_HEAD" ]; then',
    '            git -C "$ROOT_DIR" commit --no-edit',
    '          fi',
    '          node -e "' +
      "const fs=require('fs');" +
      "const file=process.argv[1];" +
      "const t=file+'.tmp.'+process.pid;" +
      "const data={epicId:process.argv[2],status:'merged',mode:'clean',details:'',timestamp:'2026-03-20T17:30:00+01:00'};" +
      "fs.writeFileSync(t,JSON.stringify(data,null,2)+'\\n');" +
      "fs.renameSync(t,file);" +
      '" "$MERGE_RESULT_PATH" "$EPIC_ID"',
    '        fi',
    '      fi',
    '    fi',
    '  fi',
    '  if [ "$HANG_VAL" = "1" ]; then',
    '    sleep 5',
    '  fi',
    'else',
    '  FINAL_ARTIFACT_ENABLED=$(printenv MOCK_FINAL_VALIDATION_ARTIFACT 2>/dev/null || true)',
    '  FINAL_VERDICT=$(printenv MOCK_FINAL_VALIDATION_VERDICT 2>/dev/null || true)',
    '  FINAL_LOG_LINE=$(printenv MOCK_FINAL_VALIDATION_LOG_LINE 2>/dev/null || true)',
    '  if [ -z "$FINAL_ARTIFACT_ENABLED" ]; then FINAL_ARTIFACT_ENABLED=1; fi',
    '  if [ -z "$FINAL_VERDICT" ]; then FINAL_VERDICT=pass; fi',
    '  if [ -z "$FINAL_LOG_LINE" ]; then FINAL_LOG_LINE="Final validation report generated"; fi',
    '  if [ "$FINAL_ARTIFACT_ENABLED" = "1" ] && [ -n "$FINAL_RESULT_PATH" ]; then',
    '    node -e "' +
      "const fs=require('fs');" +
      "const file=process.argv[1];" +
      "const verdict=(process.argv[2]||'pass').toLowerCase();" +
      "const artifact={" +
      " phase:'final-validation'," +
      " verdict: verdict === 'fail' ? 'fail' : 'pass'," +
      " tests:'pass'," +
      " browser_check:'na'," +
      " timestamp:'2026-03-19T12:27:13+01:00'" +
      "};" +
      "fs.writeFileSync(file,JSON.stringify(artifact,null,2)+'\\n');" +
      '" "$FINAL_RESULT_PATH" "$FINAL_VERDICT"',
    '  fi',
    '  printf "%s\\n" "$FINAL_LOG_LINE"',
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

  const env = createTestEnv(binDir);
  for (const [epicId, result] of Object.entries(resultMap)) {
    env[`MOCK_RESULT_${epicId.replace(/-/g, '_')}`] = result;
  }

  return { tempDir, binDir, env };
}

export function runRalph(tempDir: string, env: Record<string, string>, args: string[] = []) {
  return spawnSync(BASH, [scriptPath, 'prd.json', ...args], {
    cwd: tempDir,
    encoding: 'utf-8',
    env: {
      ...env,
      RALPH_POLL_INTERVAL_SECONDS: env.RALPH_POLL_INTERVAL_SECONDS ?? '0.05',
    },
  });
}

export function setupMergeRepo(
  epics: Array<{ id: string; title: string; fileName: string }>,
  options?: { dirtyLoopBranchBeforeMerge?: boolean; hangAfterStoryPassBeforeMerge?: boolean; skipTeamLeadMerge?: boolean },
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-merge-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);
  const dirtyLoopBranchBeforeMerge = options?.dirtyLoopBranchBeforeMerge === true;
  const hangAfterStoryPassBeforeMerge = options?.hangAfterStoryPassBeforeMerge === true;
  const skipTeamLeadMerge = options?.skipTeamLeadMerge === true;

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

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

  const mockClaude = [
    '#!/bin/sh',
    `DIRTY_LOOP_BEFORE_MERGE="${dirtyLoopBranchBeforeMerge ? '1' : '0'}"`,
    `HANG_AFTER_STORY_PASS_BEFORE_MERGE="${hangAfterStoryPassBeforeMerge ? '1' : '0'}"`,
    `SKIP_TEAM_LEAD_MERGE="${skipTeamLeadMerge ? '1' : '0'}"`,
    'STDIN=$(cat)',
    'TEAM_LEAD_OWNS_MERGE=$(printf "%s" "$STDIN" | grep -c "this Team Lead session owns the merge" || true)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'LOOP_BRANCH=$(printf "%s" "$STDIN" | sed -n \'s/^- Loop branch to merge into: //p\' | head -1)',
    'ROOT_DIR=$(printf "%s" "$STDIN" | sed -n \'s/^- Repository root for the merge attempt: //p\' | head -1)',
    'MERGE_RESULT_PATH=$(printf "%s" "$STDIN" | sed -n \'s/^- Write the final merge result artifact to: //p\' | head -1)',
    'FINAL_RESULT_PATH=$(printf "%s" "$STDIN" | grep -oE \'[^[:space:]]*final-validation-result[^[:space:]]*\\.json\' | head -1)',
    'if [ -z "$FINAL_RESULT_PATH" ]; then FINAL_RESULT_PATH="$(pwd)/.ralph-teams/state/final-validation-result-mock.json"; fi',
    'if [ -n "$EPIC_ID" ]; then',
    '  ENV_KEY="MOCK_FILE_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  FILE_NAME=$(printenv "$ENV_KEY" 2>/dev/null || true)',
    '  EPIC_BRANCH=$(git branch --show-current)',
    '  if [ -n "$FILE_NAME" ]; then',
    '    printf "content for %s\\n" "$EPIC_ID" > "$FILE_NAME"',
    '    git add "$FILE_NAME"',
    '    git commit -m "feat: add $FILE_NAME for $EPIC_ID"',
    '  fi',
    '  if [ "$DIRTY_LOOP_BEFORE_MERGE" = "1" ]; then',
    '    if [ -n "$ROOT_DIR" ] && [ -f "$ROOT_DIR/prd.json" ]; then',
    '      node -e "' +
      "const fs=require('fs');" +
      "const f=process.argv[1];" +
      "const p=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "p.project=String(p.project)+' dirty';" +
      "const t=f+'.tmp.'+process.pid;" +
      "fs.writeFileSync(t,JSON.stringify(p,null,2)+'\\n');" +
      "fs.renameSync(t,f);" +
      '" "$ROOT_DIR/prd.json"',
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
    '  if [ "$HANG_AFTER_STORY_PASS_BEFORE_MERGE" = "1" ]; then',
    '    sleep 5',
    '    exit 0',
    '  fi',
    '  if [ "$SKIP_TEAM_LEAD_MERGE" != "1" ] && [ "$TEAM_LEAD_OWNS_MERGE" != "0" ] && [ -n "$LOOP_BRANCH" ] && [ -n "$ROOT_DIR" ] && [ -n "$MERGE_RESULT_PATH" ]; then',
    '    if [ -n "$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null || true)" ]; then',
    '      git -C "$ROOT_DIR" add -A',
    '      git -C "$ROOT_DIR" commit -m "chore: checkpoint loop branch before merge wave"',
    '    fi',
    '    git -C "$ROOT_DIR" checkout "$LOOP_BRANCH"',
    '    if git -C "$ROOT_DIR" merge "$EPIC_BRANCH" --no-commit --no-ff; then',
    '      if [ -f "$ROOT_DIR/.git/MERGE_HEAD" ]; then',
    '        git -C "$ROOT_DIR" commit --no-edit',
    '      fi',
    '      node -e "' +
      "const fs=require('fs');" +
      "const file=process.argv[1];" +
      "const t=file+'.tmp.'+process.pid;" +
      "const data={epicId:process.argv[2],status:'merged',mode:'clean',details:'',timestamp:'2026-03-20T17:30:00+01:00'};" +
      "fs.writeFileSync(t,JSON.stringify(data,null,2)+'\\n');" +
      "fs.renameSync(t,file);" +
      '" "$MERGE_RESULT_PATH" "$EPIC_ID"',
    '    fi',
    '  fi',
    'else',
    '  if printf "%s" "$STDIN" | grep -q "Validate the final integrated branch"; then',
    '    MAIN_ROOT=$(git worktree list --porcelain | awk \'/^worktree / {print $2; exit}\')',
    '    if [ -n "$MAIN_ROOT" ] && [ -d "$MAIN_ROOT" ]; then',
    '      touch "$MAIN_ROOT/final-validator-invoked.txt"',
    '    else',
    '      touch final-validator-invoked.txt',
    '    fi',
    '    FINAL_ARTIFACT_ENABLED=$(printenv MOCK_FINAL_VALIDATION_ARTIFACT 2>/dev/null || true)',
    '    FINAL_VERDICT=$(printenv MOCK_FINAL_VALIDATION_VERDICT 2>/dev/null || true)',
    '    FINAL_LOG_LINE=$(printenv MOCK_FINAL_VALIDATION_LOG_LINE 2>/dev/null || true)',
    '    if [ -z "$FINAL_ARTIFACT_ENABLED" ]; then FINAL_ARTIFACT_ENABLED=1; fi',
    '    if [ -z "$FINAL_VERDICT" ]; then FINAL_VERDICT=pass; fi',
    '    if [ -z "$FINAL_LOG_LINE" ]; then FINAL_LOG_LINE="Final validation report generated"; fi',
    '    if [ "$FINAL_ARTIFACT_ENABLED" = "1" ] && [ -n "$FINAL_RESULT_PATH" ]; then',
    '      node -e "' +
      "const fs=require('fs');" +
      "const file=process.argv[1];" +
      "const verdict=(process.argv[2]||'pass').toLowerCase();" +
      "const artifact={" +
      " phase:'final-validation'," +
      " verdict: verdict === 'fail' ? 'fail' : 'pass'," +
      " tests:'pass'," +
      " browser_check:'na'," +
      " timestamp:'2026-03-19T12:27:13+01:00'" +
      "};" +
      "fs.writeFileSync(file,JSON.stringify(artifact,null,2)+'\\n');" +
      '" "$FINAL_RESULT_PATH" "$FINAL_VERDICT"',
    '    fi',
    '    printf "%s\\n" "$FINAL_LOG_LINE"',
    '  else',
    '    printf "VERDICT: PASS\\n"',
    '  fi',
    'fi',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'claude'), mockClaude);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  const env = createTestEnv(binDir);
  for (const e of epics) {
    env[`MOCK_FILE_${e.id.replace(/-/g, '_')}`] = e.fileName;
  }

  return { tempDir, binDir, env };
}

export function setupConflictRepo(options?: { resolveWithTeamLead?: boolean }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-conflict-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);
  const resolveWithTeamLead = options?.resolveWithTeamLead === true;

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

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

  const mockClaude = [
    '#!/bin/sh',
    `RESOLVE_WITH_TEAM_LEAD="${resolveWithTeamLead ? '1' : '0'}"`,
    'STDIN=$(cat)',
    'TEAM_LEAD_OWNS_MERGE=$(printf "%s" "$STDIN" | grep -c "this Team Lead session owns the merge" || true)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'WORKTREE=$(printf "%s" "$STDIN" | grep -oE "[^ ]*\\.worktrees/[^ ]*" | head -1)',
    'LOOP_BRANCH=$(printf "%s" "$STDIN" | sed -n \'s/^- Loop branch to merge into: //p\' | head -1)',
    'ROOT_DIR=$(printf "%s" "$STDIN" | sed -n \'s/^- Repository root for the merge attempt: //p\' | head -1)',
    'MERGE_RESULT_PATH=$(printf "%s" "$STDIN" | sed -n \'s/^- Write the final merge result artifact to: //p\' | head -1)',
    'if [ -n "$EPIC_ID" ] && [ -n "$WORKTREE" ] && [ -d "$WORKTREE" ]; then',
    '  printf "epic version\\n" > "$WORKTREE/README.md"',
    '  git -C "$WORKTREE" add README.md',
    '  git -C "$WORKTREE" commit -m "feat: epic change to README"',
    '  if [ -n "$ROOT_DIR" ] && [ -d "$ROOT_DIR" ]; then',
    '    printf "main version\\n" > "$ROOT_DIR/README.md"',
    '    git -C "$ROOT_DIR" add README.md',
    '    git -C "$ROOT_DIR" -c user.name="Ralph Test" -c user.email="ralph@example.com" commit -m "chore: main change to README"',
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
    '  if [ "$TEAM_LEAD_OWNS_MERGE" != "0" ] && [ -n "$LOOP_BRANCH" ] && [ -n "$ROOT_DIR" ] && [ -n "$MERGE_RESULT_PATH" ]; then',
    '    MAIN_ROOT=$(git -C "$ROOT_DIR" worktree list --porcelain | awk \'/^worktree / {print $2; exit}\')',
    '    if [ -n "$MAIN_ROOT" ] && [ -d "$MAIN_ROOT" ]; then',
    '      touch "$MAIN_ROOT/team-lead-merge-invoked.txt"',
    '    fi',
    '    EPIC_BRANCH=$(git -C "$WORKTREE" branch --show-current)',
    '    git -C "$ROOT_DIR" checkout "$LOOP_BRANCH"',
    '    if git -C "$ROOT_DIR" merge "$EPIC_BRANCH" --no-commit --no-ff; then',
    '      if [ -f "$ROOT_DIR/.git/MERGE_HEAD" ]; then',
    '        git -C "$ROOT_DIR" commit --no-edit',
    '      fi',
    '      node -e "' +
      "const fs=require('fs');" +
      "const file=process.argv[1];" +
      "const t=file+'.tmp.'+process.pid;" +
      "const data={epicId:process.argv[2],status:'merged',mode:'clean',details:'',timestamp:'2026-03-20T17:30:00+01:00'};" +
      "fs.writeFileSync(t,JSON.stringify(data,null,2)+'\\n');" +
      "fs.renameSync(t,file);" +
      '" "$MERGE_RESULT_PATH" "$EPIC_ID"',
    '    else',
    '      if [ "$RESOLVE_WITH_TEAM_LEAD" = "1" ]; then',
    '        printf "main version\\nepic version\\n" > "$ROOT_DIR/README.md"',
    '        git -C "$ROOT_DIR" add README.md',
    '        git -C "$ROOT_DIR" commit --no-edit',
    '        node -e "' +
      "const fs=require('fs');" +
      "const file=process.argv[1];" +
      "const t=file+'.tmp.'+process.pid;" +
      "const data={epicId:process.argv[2],status:'merged',mode:'conflict-resolved',details:'',timestamp:'2026-03-20T17:30:00+01:00'};" +
      "fs.writeFileSync(t,JSON.stringify(data,null,2)+'\\n');" +
      "fs.renameSync(t,file);" +
      '" "$MERGE_RESULT_PATH" "$EPIC_ID"',
    '      else',
    '        git -C "$ROOT_DIR" merge --abort',
    '        node -e "' +
      "const fs=require('fs');" +
      "const file=process.argv[1];" +
      "const t=file+'.tmp.'+process.pid;" +
      "const data={epicId:process.argv[2],status:'merge-failed',mode:'unknown',details:'team lead could not resolve conflict',timestamp:'2026-03-20T17:30:00+01:00'};" +
      "fs.writeFileSync(t,JSON.stringify(data,null,2)+'\\n');" +
      "fs.renameSync(t,file);" +
      '" "$MERGE_RESULT_PATH" "$EPIC_ID"',
    '      fi',
    '    fi',
    '  fi',
    '  exit 0',
    'fi',
    'if printf "%s" "$STDIN" | grep -q -- "Take over this merge conflict resolution directly"; then',
    '  MAIN_ROOT=$(git worktree list --porcelain | awk \'/^worktree / {print $2; exit}\')',
    '  if [ -n "$MAIN_ROOT" ] && [ -d "$MAIN_ROOT" ]; then',
    '    touch "$MAIN_ROOT/team-lead-merge-invoked.txt"',
    '  else',
    '    touch team-lead-merge-invoked.txt',
    '  fi',
    '  if [ "$RESOLVE_WITH_TEAM_LEAD" = "1" ]; then',
    '    printf "main version\\nepic version\\n" > README.md',
    '    git add README.md',
    '    echo MERGE_SUCCESS',
    '    exit 0',
    '  fi',
    '  echo MERGE_FAILED',
    '  exit 0',
    'fi',
    'printf "VERDICT: PASS\\n"',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'claude'), mockClaude);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  const env = createTestEnv(binDir);

  return { tempDir, binDir, env };
}

export function setupIdleTimeoutRepo(
  epics: Array<{ id: string; title: string }>,
  resultMap: Record<string, string> = {},
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-idle-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'TEAM_LEAD_OWNS_MERGE=$(printf "%s" "$STDIN" | grep -c "this Team Lead session owns the merge" || true)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'LOOP_BRANCH=$(printf "%s" "$STDIN" | sed -n \'s/^- Loop branch to merge into: //p\' | head -1)',
    'ROOT_DIR=$(printf "%s" "$STDIN" | sed -n \'s/^- Repository root for the merge attempt: //p\' | head -1)',
    'MERGE_RESULT_PATH=$(printf "%s" "$STDIN" | sed -n \'s/^- Write the final merge result artifact to: //p\' | head -1)',
    'if [ -n "$EPIC_ID" ]; then',
    '  SILENT_KEY="MOCK_SILENT_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  SILENT_VAL=$(printenv "$SILENT_KEY" 2>/dev/null || true)',
    '  RESULT_KEY="MOCK_RESULT_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  RESULT_VAL=$(printenv "$RESULT_KEY" 2>/dev/null || true)',
    '  if [ "$SILENT_VAL" = "1" ]; then',
    '    sleep 5',
    '  elif [ -n "$RESULT_VAL" ]; then',
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
    '      EPIC_BRANCH=$(git branch --show-current)',
    '      if [ "$TEAM_LEAD_OWNS_MERGE" != "0" ] && [ -n "$LOOP_BRANCH" ] && [ -n "$ROOT_DIR" ] && [ -n "$MERGE_RESULT_PATH" ]; then',
    '        git -C "$ROOT_DIR" checkout "$LOOP_BRANCH"',
    '        if git -C "$ROOT_DIR" merge "$EPIC_BRANCH" --no-commit --no-ff; then',
    '          if [ -f "$ROOT_DIR/.git/MERGE_HEAD" ]; then',
    '            git -C "$ROOT_DIR" commit --no-edit',
    '          fi',
    '          node -e "' +
      "const fs=require('fs');" +
      "const file=process.argv[1];" +
      "const t=file+'.tmp.'+process.pid;" +
      "const data={epicId:process.argv[2],status:'merged',mode:'clean',details:'',timestamp:'2026-03-20T17:30:00+01:00'};" +
      "fs.writeFileSync(t,JSON.stringify(data,null,2)+'\\n');" +
      "fs.renameSync(t,file);" +
      '" "$MERGE_RESULT_PATH" "$EPIC_ID"',
    '        fi',
    '      fi',
    '    fi',
    '  fi',
    'else',
    '  printf "VERDICT: PASS\\n"',
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

  const env = createTestEnv(binDir);
  for (const [epicId, result] of Object.entries(resultMap)) {
    env[`MOCK_RESULT_${epicId.replace(/-/g, '_')}`] = result;
  }

  return { tempDir, binDir, env };
}

export function runRalphWithSigint(
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
      if (!sigintSent && stdout.includes('Spawning')) {
        sigintSent = true;
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
