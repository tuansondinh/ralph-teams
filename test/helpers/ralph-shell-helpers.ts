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
    '    sleep 5',
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

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    RALPH_MAX_CRASH_RETRIES: '0',
  };
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
  options?: { dirtyLoopBranchBeforeMerge?: boolean },
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-merge-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);
  const dirtyLoopBranchBeforeMerge = options?.dirtyLoopBranchBeforeMerge === true;

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
    'else',
    '  if printf "%s" "$STDIN" | grep -q "Validate the final integrated branch"; then',
    '    touch final-validator-invoked.txt',
    '  fi',
    '  printf "VERDICT: PASS\\n"',
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
  for (const e of epics) {
    env[`MOCK_FILE_${e.id.replace(/-/g, '_')}`] = e.fileName;
  }

  return { tempDir, binDir, env };
}

export function setupConflictRepo(options?: { resolveWithMerger?: boolean }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-conflict-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);
  const resolveWithMerger = options?.resolveWithMerger === true;

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
    `RESOLVE_WITH_MERGER="${resolveWithMerger ? '1' : '0'}"`,
    'STDIN=$(cat)',
    'ARGS="$*"',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'WORKTREE=$(printf "%s" "$STDIN" | grep -oE "[^ ]*\\.worktrees/[^ ]*" | head -1)',
    'if [ -n "$EPIC_ID" ] && [ -n "$WORKTREE" ] && [ -d "$WORKTREE" ]; then',
    '  printf "epic version\\n" > "$WORKTREE/README.md"',
    '  git -C "$WORKTREE" add README.md',
    '  git -C "$WORKTREE" commit -m "feat: epic change to README"',
    '  MAIN_ROOT=$(git -C "$WORKTREE" worktree list --porcelain | grep "^worktree" | head -1 | awk "{print \\$2}")',
    '  if [ -n "$MAIN_ROOT" ] && [ -d "$MAIN_ROOT" ]; then',
    '    printf "main version\\n" > "$MAIN_ROOT/README.md"',
    '    git -C "$MAIN_ROOT" add README.md',
    '    git -C "$MAIN_ROOT" -c user.name="Ralph Test" -c user.email="ralph@example.com" commit -m "chore: main change to README"',
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
    '  exit 0',
    'fi',
    'if printf "%s" "$ARGS" | grep -q -- "--agent merger"; then',
    '  touch merger-agent-invoked.txt',
    '  if [ "$RESOLVE_WITH_MERGER" = "1" ]; then',
    '    printf "main version\\nepic version\\n" > README.md',
    '    git add README.md',
    '    echo MERGE_SUCCESS',
    '    exit 0',
    '  fi',
    'fi',
    'printf "VERDICT: PASS\\n"',
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
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
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

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    RALPH_MAX_CRASH_RETRIES: '0',
  };
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
