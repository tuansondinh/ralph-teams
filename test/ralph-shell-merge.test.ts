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
  assert.match(gitignore, /^\.ralph-teams$/m);
  assert.match(gitignore, /^\.ralph-teams\/$/m);
});

test('US-004: clean merge succeeds without team lead takeover', () => {
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

test('US-004: single-epic runs skip final validation', () => {
  const { tempDir, env } = setupMergeRepo([{ id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' }]);
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.equal(fs.existsSync(path.join(tempDir, 'final-validator-invoked.txt')), false);
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
  assert.equal(fs.existsSync(path.join(tempDir, 'final-validator-invoked.txt')), true);
});

test('US-004: final validation uses the result artifact instead of scraping the prose log', () => {
  const { tempDir, env } = setupMergeRepo(
    [{ id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' }, { id: 'EPIC-002', title: 'Beta', fileName: 'beta.txt' }],
  );
  env.MOCK_FINAL_VALIDATION_LOG_LINE = '## Final Validation Report';
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  const stateDir = path.join(tempDir, '.ralph-teams', 'state');
  const artifactName = fs.readdirSync(stateDir).find((name) => /^final-validation-result-.*\.json$/.test(name));
  assert.ok(artifactName, 'expected final validation result artifact to be written');
  const artifactPath = path.join(stateDir, artifactName);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  assert.equal(artifact.phase, 'final-validation');
  assert.equal(artifact.verdict, 'pass');

  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  const validationLogName = fs.readdirSync(logsDir).find((name) => /^final-validation-.*\.log$/.test(name));
  assert.ok(validationLogName, 'expected final validation raw log to be written');
  const validationLog = fs.readFileSync(path.join(logsDir, validationLogName), 'utf-8');
  assert.match(validationLog, /## Final Validation Report/);

  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /\[FINAL\] FINAL VALIDATION PASSED/);
});

test('US-004: final validation announces validator spawning and leaves fixes to the validator session', () => {
  const { tempDir, env } = setupMergeRepo(
    [{ id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' }, { id: 'EPIC-002', title: 'Beta', fileName: 'beta.txt' }],
  );
  env.RALPH_FINAL_VALIDATION_ENABLED = '1';
  env.RALPH_FINAL_VALIDATION_MAX_FIX_CYCLES = '1';
  env.MOCK_FINAL_VALIDATION_VERDICT = 'fail';
  env.MOCK_FINAL_VALIDATION_LOG_LINE = 'Final validation failed with actionable findings';

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 1, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /--- Final validation ---/);
  assert.match(result.stdout, /Spawning final validator\.\.\./);
  assert.match(result.stdout, /Final validation FAILED/);
  assert.doesNotMatch(result.stdout, /Spawning final fix/);
});

test('US-004: resume recovers completed-but-unmerged epic branches before finishing the run', () => {
  const { tempDir, env } = setupMergeRepo(
    [{ id: 'EPIC-001', title: 'Alpha', fileName: 'alpha.txt' }, { id: 'EPIC-002', title: 'Beta', fileName: 'beta.txt' }],
  );

  const runtimeDir = path.join(tempDir, '.ralph-teams');
  fs.mkdirSync(runtimeDir, { recursive: true });

  execFileSync('git', ['checkout', '-b', 'ralph/loop/test-resume'], { cwd: tempDir });
  execFileSync('git', ['checkout', '-b', 'ralph/EPIC-001'], { cwd: tempDir });
  fs.writeFileSync(path.join(tempDir, 'alpha.txt'), 'content for EPIC-001\n');
  execFileSync('git', ['add', 'alpha.txt'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'feat: add alpha.txt for EPIC-001'], { cwd: tempDir });
  execFileSync('git', ['checkout', 'ralph/loop/test-resume'], { cwd: tempDir });

  const prdPath = path.join(tempDir, 'prd.json');
  const prd = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  prd.epics[0].status = 'completed';
  prd.epics[0].userStories[0].passes = true;
  fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2));
  execFileSync('git', ['add', 'prd.json'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: persist completed epic before resume'], { cwd: tempDir });
  execFileSync('git', ['checkout', 'main'], { cwd: tempDir });

  const state = {
    version: 1,
    prdFile: prdPath,
    sourceBranch: 'main',
    loopBranch: 'ralph/loop/test-resume',
    currentWave: 1,
    activeEpics: [],
    backend: 'claude',
    parallel: '2',
    storyProgress: {
      'EPIC-001': { 'US-001': true },
      'EPIC-002': { 'US-001': false },
    },
    interruptedStoryId: null,
    timestamp: '2026-03-18T00:00:00Z',
  };
  fs.writeFileSync(path.join(runtimeDir, 'ralph-state.json'), JSON.stringify(state, null, 2));

  const result = spawnSync(BASH, [scriptPath, 'prd.json', '--backend', 'claude', '--parallel', '2'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env: {
      ...env,
      RALPH_RESUME: '1',
    },
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /Recovered pending merge from existing epic branch/);
  assert.match(result.stdout, /\[EPIC-001\] Merge successful \(clean\)/);
  assert.match(result.stdout, /\[EPIC-002\] Merge successful \(clean\)/);

  const progress = fs.readFileSync(path.join(runtimeDir, 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] RECOVERED PENDING MERGE \(resume\/startup\)/);
  assert.match(progress, /\[EPIC-001\] MERGED \(clean\)/);
  assert.match(progress, /\[EPIC-002\] MERGED \(clean\)/);

  const branches = execFileSync('git', ['branch'], { cwd: tempDir, encoding: 'utf-8' });
  assert.doesNotMatch(branches, /ralph\/EPIC-001/);
  assert.doesNotMatch(branches, /ralph\/EPIC-002/);

  const finalPrd = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  assert.equal(finalPrd.epics[0].status, 'completed');
  assert.equal(finalPrd.epics[1].status, 'completed');
  assert.equal(fs.existsSync(path.join(tempDir, 'final-validator-invoked.txt')), true);
});

test('US-005: merge-failed status set when conflict cannot be resolved', () => {
  const { tempDir, env } = setupConflictRepo();
  runRalph(tempDir, env);
  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  assert.equal(prd.epics[0].status, 'merge-failed');
});

test('US-005: recovered pending merges trigger team lead takeover when conflicts exist', () => {
  const { tempDir, env } = setupConflictRepo({ resolveWithTeamLead: true });
  const runtimeDir = path.join(tempDir, '.ralph-teams');
  fs.mkdirSync(runtimeDir, { recursive: true });

  execFileSync('git', ['checkout', '-b', 'ralph/loop/test-resume-conflict'], { cwd: tempDir });
  execFileSync('git', ['checkout', '-b', 'ralph/EPIC-001'], { cwd: tempDir });
  fs.writeFileSync(path.join(tempDir, 'README.md'), 'epic version\n');
  execFileSync('git', ['add', 'README.md'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'feat: epic change to README'], { cwd: tempDir });
  execFileSync('git', ['checkout', 'ralph/loop/test-resume-conflict'], { cwd: tempDir });
  fs.writeFileSync(path.join(tempDir, 'README.md'), 'main version\n');
  execFileSync('git', ['add', 'README.md'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: main change to README'], { cwd: tempDir });

  const prdPath = path.join(tempDir, 'prd.json');
  const prd = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  prd.epics[0].status = 'completed';
  prd.epics[0].userStories[0].passes = true;
  fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2));
  execFileSync('git', ['add', 'prd.json'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'chore: persist completed epic before resume'], { cwd: tempDir });
  execFileSync('git', ['checkout', 'main'], { cwd: tempDir });

  const state = {
    version: 1,
    prdFile: prdPath,
    sourceBranch: 'main',
    loopBranch: 'ralph/loop/test-resume-conflict',
    currentWave: 1,
    activeEpics: [],
    backend: 'claude',
    parallel: '',
    storyProgress: {
      'EPIC-001': { 'US-001': true },
    },
    interruptedStoryId: null,
    timestamp: '2026-03-18T00:00:00Z',
  };
  fs.writeFileSync(path.join(runtimeDir, 'ralph-state.json'), JSON.stringify(state, null, 2));

  const result = spawnSync(BASH, [scriptPath, 'prd.json', '--backend', 'claude'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env: {
      ...env,
      RALPH_RESUME: '1',
    },
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] conflicts detected — team lead takeover/);
  assert.match(result.stdout, /\[EPIC-001\] merged \(AI-resolved conflicts\)/);
  assert.ok(fs.existsSync(path.join(tempDir, 'team-lead-merge-invoked.txt')));
  const progress = fs.readFileSync(path.join(runtimeDir, 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] RECOVERED PENDING MERGE \(resume\/startup\)/);
  assert.match(progress, /\[EPIC-001\] MERGED \(AI-resolved\)/);
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

test('US-005: merge log file created when team lead takeover runs', () => {
  const { tempDir, env } = setupConflictRepo();
  runRalph(tempDir, env);
  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  assert.ok(fs.existsSync(logsDir));
  const mergeLogs = fs.readdirSync(logsDir).filter((f) => f.startsWith('merge-EPIC-001'));
  assert.ok(mergeLogs.length > 0);
});

test('US-005: team lead takeover can resolve a simple conflict end to end', () => {
  const { tempDir, env } = setupConflictRepo({ resolveWithTeamLead: true });
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] merged \(AI-resolved conflicts\)/);
  const prd = JSON.parse(fs.readFileSync(path.join(tempDir, 'prd.json'), 'utf-8'));
  assert.equal(prd.epics[0].status, 'completed');
  assert.ok(fs.existsSync(path.join(tempDir, 'team-lead-merge-invoked.txt')));
  const readme = fs.readFileSync(path.join(tempDir, 'README.md'), 'utf-8');
  assert.equal(readme, 'main version\nepic version\n');
  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  const mergeLogs = fs.readdirSync(logsDir).filter((f) => f.startsWith('merge-EPIC-001'));
  assert.ok(mergeLogs.length > 0);
  const mergeLog = fs.readFileSync(path.join(logsDir, mergeLogs[0]), 'utf-8');
  assert.match(mergeLog, /MERGE_SUCCESS/);
});
