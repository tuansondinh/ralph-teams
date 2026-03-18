import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  BASH,
  runRalph,
  scriptPath,
  setupConflictRepo,
  setupMergeRepo,
  setupMultiEpicRepo,
} from './helpers/ralph-shell-helpers.js';

test('US-004: merge is attempted after wave completes — progress.txt contains merge entry', () => {
  const { tempDir, env } = setupMergeRepo([{ id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' }]);
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

  const prd = { project: 'Worktree PRD Test', epics: [{ id: 'EPIC-001', title: 'Alpha', status: 'pending', userStories: [{ id: 'US-001', title: 'Story', passes: false }] }] };
  fs.writeFileSync(path.join(tempDir, 'prd.json'), JSON.stringify(prd, null, 2));
  fs.writeFileSync(path.join(tempDir, 'README.md'), 'initial\n');
  execFileSync('git', ['add', '.'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: tempDir });

  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'WORKTREE=$(printf "%s" "$STDIN" | awk \'/ALL work for this epic MUST happen in this directory:/ {sub(/^.*directory: /, ""); print; exit}\')',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'if [ -n "$EPIC_ID" ] && [ -n "$WORKTREE" ]; then',
    '  cd "$WORKTREE" || exit 1',
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
      "const f=process.argv[1];" +
      "const epicId=process.argv[2];" +
      "const p=JSON.parse(fs.readFileSync(f,'utf8'));" +
      "const e=p.epics.find(x=>x.id===epicId);" +
      "if(e)e.userStories.forEach(s=>{s.passes=true;});" +
      "const t=f+'.tmp.'+process.pid;" +
      "fs.writeFileSync(t,JSON.stringify(p,null,2)+'\\n');" +
      "fs.renameSync(t,f);" +
    '" "$PRD_PATH" "$EPIC_ID"',
    '  git add prd.json',
    '  git commit -m "feat: mark story passed in worktree PRD"',
    'else',
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

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] MERGED/);
  const finalPrd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  assert.equal(finalPrd.epics[0]?.status, 'completed');
  assert.equal(finalPrd.epics[0]?.userStories[0]?.passes, true);
});

test('ralph.sh auto-adds runtime artifacts to the repo .gitignore', () => {
  const { tempDir, env } = setupMergeRepo([{ id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' }]);
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
  const { tempDir, env } = setupMergeRepo([{ id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' }]);
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] Merge successful \(clean\)/);
  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  if (fs.existsSync(logsDir)) {
    const mergeLogs = fs.readdirSync(logsDir).filter((f) => f.startsWith('merge-'));
    assert.equal(mergeLogs.length, 0);
  }
});

test('US-004: dirty loop branch is auto-committed before merge', () => {
  const { tempDir, env } = setupMergeRepo([{ id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' }], { dirtyLoopBranchBeforeMerge: true });
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
  const { tempDir, env } = setupMergeRepo([{ id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' }]);
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  const branches = execFileSync('git', ['branch'], { cwd: tempDir, encoding: 'utf-8' });
  assert.doesNotMatch(branches, /ralph\/EPIC-001/);
});

test('US-004: two independent epics both merge cleanly after wave', () => {
  const { tempDir, env } = setupMergeRepo(
    [{ id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' }, { id: 'EPIC-002', title: 'Beta', fileName: 'beta.txt' }],
  );
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] MERGED/);
  assert.match(progress, /\[EPIC-002\] MERGED/);
  const branches = execFileSync('git', ['branch'], { cwd: tempDir, encoding: 'utf-8' });
  assert.doesNotMatch(branches, /ralph\/EPIC-001/);
  assert.doesNotMatch(branches, /ralph\/EPIC-002/);
});

test('US-005: merge-failed status set when conflict cannot be resolved', () => {
  const { tempDir, env } = setupConflictRepo();
  runRalph(tempDir, env);
  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  assert.equal(prd.epics[0].status, 'merge-failed');
});

test('US-005: conflict resolution attempt is logged to progress.txt', () => {
  const { tempDir, env } = setupConflictRepo();
  runRalph(tempDir, env);
  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] merge conflicts/);
  assert.match(progress, /\[EPIC-001\] MERGE FAILED/);
});

test('US-005: merge-failed epic does not block independent epics in later waves', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha', status: 'merge-failed' },
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },
      { id: 'EPIC-003', title: 'Gamma' },
    ],
    { 'EPIC-003': 'PASS' },
  );
  const result = runRalph(tempDir, env);
  assert.match(result.stdout, /\[EPIC-003\] PASSED/);
  assert.match(result.stdout, /\[EPIC-002\].*[Ss]kipped/);
});

test('US-005: merge log file created when merger agent is spawned', () => {
  const { tempDir, env } = setupConflictRepo();
  runRalph(tempDir, env);
  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  assert.ok(fs.existsSync(logsDir));
  const mergeLogs = fs.readdirSync(logsDir).filter((f) => f.startsWith('merge-EPIC-001'));
  assert.ok(mergeLogs.length > 0);
});

test('US-005: merger agent is spawned and can resolve a simple conflict end to end', () => {
  const { tempDir, env } = setupConflictRepo({ resolveWithMerger: true });
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] merged \(AI-resolved conflicts\)/);
  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  assert.equal(prd.epics[0].status, 'completed');
  assert.ok(fs.existsSync(path.join(tempDir, 'merger-agent-invoked.txt')));
  const readme = fs.readFileSync(path.join(tempDir, 'README.md'), 'utf-8');
  assert.equal(readme, 'main version\nepic version\n');
  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  const mergeLogs = fs.readdirSync(logsDir).filter((f) => f.startsWith('merge-EPIC-001'));
  assert.ok(mergeLogs.length > 0);
  const mergeLog = fs.readFileSync(path.join(logsDir, mergeLogs[0]), 'utf-8');
  assert.match(mergeLog, /MERGE_SUCCESS/);
});
