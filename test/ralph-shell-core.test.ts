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
  setupMultiEpicRepo,
  setupTempRepo,
  setupUnbornRepo,
} from './helpers/ralph-shell-helpers.js';

test('ralph.sh auto-commits dirty changes without prompting before switching branches', () => {
  const { tempDir, binDir } = setupTempRepo();
  const result = spawnSync(BASH, [scriptPath, 'prd.json'], {
    cwd: tempDir,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
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
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
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
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    encoding: 'utf-8',
  });

  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(combined, /Error: failed to create loop branch 'ralph\/loop\//);
  assert.match(combined, /fatal: simulated loop branch creation failure/);
  assert.doesNotMatch(combined, /invalid reference:/);
});

test('codex backend suppresses bare file-path chatter in stdout while keeping outcome lines', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-codex-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  const mockCodex = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'STATE_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## Epic State File$/ {found=1}\')',
    'PRD_PATH=$(printf "%s" "$STDIN" | awk \'found {print; exit} /^## PRD File Path/ {found=1}\')',
    'if [ -n "$EPIC_ID" ]; then',
    '  printf "./src/config.ts\\n"',
    '  printf "./src/index.ts\\n"',
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
    '  printf "PASS\\n"',
    'else',
    '  printf "VERDICT: PASS\\n"',
    'fi',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'codex'), mockCodex);
  fs.chmodSync(path.join(binDir, 'codex'), 0o755);

  execFileSync('git', ['init', '-b', 'main'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: tempDir });
  execFileSync('git', ['config', 'user.email', 'ralph@example.com'], { cwd: tempDir });

  fs.writeFileSync(path.join(tempDir, 'prd.json'), JSON.stringify({
    project: 'Codex Noise Test',
    epics: [{ id: 'EPIC-001', title: 'Alpha', status: 'pending', userStories: [{ id: 'US-001', title: 'Story', passes: false }] }],
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

test('write_codex_agent_config rewrites generated codex roles without duplicate top-level keys', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-codex-config-'));
  const sourceFile = path.join(tempDir, 'builder.toml');
  const outputFile = path.join(tempDir, 'builder-runtime.toml');
  const script = fs.readFileSync(scriptPath, 'utf-8');
  const fnMatch = script.match(/write_codex_agent_config\(\) \{[\s\S]*?^}/m);

  assert.ok(fnMatch, 'expected write_codex_agent_config to exist in ralph.sh');

  fs.writeFileSync(sourceFile, [
    '# Generated prompt',
    'name = "builder"',
    'description = "Builder role"',
    'sandbox_mode = "workspace-write"',
    'developer_instructions = """',
    'model = "should stay inside the prompt body"',
    'sandbox_mode = "should also stay inside the prompt body"',
    '"""',
    '',
  ].join('\n'));

  const result = spawnSync(BASH, ['-lc', `${fnMatch[0]}\nwrite_codex_agent_config "$1" "$2" "$3"` , '--', sourceFile, outputFile, 'gpt-5.3-codex'], {
    cwd: tempDir,
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  const output = fs.readFileSync(outputFile, 'utf-8');
  const header = output.split('developer_instructions = """')[0] ?? output;
  assert.equal((header.match(/^sandbox_mode = /gm) ?? []).length, 1);
  assert.equal((header.match(/^model = /gm) ?? []).length, 1);
  assert.match(output, /^sandbox_mode = "workspace-write"\nmodel = "gpt-5\.3-codex"\n# Generated prompt/m);
  assert.match(output, /developer_instructions = """\nmodel = "should stay inside the prompt body"\nsandbox_mode = "should also stay inside the prompt body"\n"""/);
});

test('rjq helper re-resolves to a working binary when the cached path is stale', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-rjq-fallback-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  const fallbackRjq = [
    '#!/bin/sh',
    'printf "RECOVERED:%s\\n" "$*"',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'rjq'), fallbackRjq);
  fs.chmodSync(path.join(binDir, 'rjq'), 0o755);

  const script = fs.readFileSync(scriptPath, 'utf-8');
  const resolveMatch = script.match(/resolve_rjq_bin\(\) \{[\s\S]*?^}/m);
  const rjqMatch = script.match(/rjq\(\) \{[\s\S]*?^}/m);

  assert.ok(resolveMatch, 'expected resolve_rjq_bin to exist in ralph.sh');
  assert.ok(rjqMatch, 'expected rjq helper to exist in ralph.sh');

  const result = spawnSync(BASH, ['-c', [
    `PATH="${binDir}:${process.env.PATH ?? ''}"`,
    `SCRIPT_DIR="${tempDir}"`,
    'RJQ_BIN="/definitely/missing/rjq"',
    resolveMatch[0],
    rjqMatch[0],
    'rjq read sample.json .value',
  ].join('\n')], {
    cwd: tempDir,
    encoding: 'utf-8',
    env: { ...process.env },
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /RECOVERED:read sample\.json \.value/);
});

test('US-001: two independent epics run in the same wave', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }, { id: 'EPIC-002', title: 'Beta' }],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /2 epic\(s\) remaining to run sequentially/);
  assert.doesNotMatch(result.stdout, /Wave 1/);
  assert.doesNotMatch(result.stdout, /Wave 2/);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  assert.match(result.stdout, /\[EPIC-002\] PASSED/);
});

test('US-001: dependent epic runs after its dependency completes', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }, { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] }],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  const remainingMatches = result.stdout.match(/[12] epic\(s\) remaining to run sequentially/g) ?? [];
  assert.equal(remainingMatches.length, 2);
  const firstRemainingPos = result.stdout.indexOf('2 epic(s) remaining to run sequentially');
  const secondRemainingPos = result.stdout.indexOf('1 epic(s) remaining to run sequentially');
  const epic1PassedPos = result.stdout.indexOf('[EPIC-001] PASSED');
  assert.ok(firstRemainingPos !== -1 && secondRemainingPos !== -1 && epic1PassedPos !== -1);
  assert.ok(firstRemainingPos < epic1PassedPos);
  assert.ok(epic1PassedPos < secondRemainingPos);
});

test('US-001: circular dependency detected — exits with code 1', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha', dependsOn: ['EPIC-002'] },
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },
    ],
  );
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 1);
  assert.match(result.stderr || result.stdout, /circular dependency|cycle/i);
});

test('US-001: failed dependency causes dependent to be skipped, independent still runs', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },
      { id: 'EPIC-003', title: 'Gamma' },
    ],
    { 'EPIC-003': 'PASS' },
  );
  const result = runRalph(tempDir, env);
  assert.match(result.stdout, /\[EPIC-003\] PASSED/);
  assert.match(result.stdout, /\[EPIC-002\].*[Ss]kipped/);
});

test('US-001: wave boundaries are logged to progress.txt', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }, { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] }],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );
  runRalph(tempDir, env);
  const progress = fs.readFileSync(path.join(tempDir, '.ralph-teams', 'progress.txt'), 'utf-8');
  assert.match(progress, /=== Run/);
  assert.match(progress, /EPIC-001/);
  assert.match(progress, /EPIC-002/);
});

test('US-001: rerunning Ralph automatically retries failed epics', () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], {});
  const first = runRalph(tempDir, env);
  assert.equal(first.status, 1);
  const prdPath = path.join(tempDir, 'prd.json');
  const prd = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  prd.epics[0].status = 'pending';
  fs.writeFileSync(prdPath, `${JSON.stringify(prd, null, 2)}\n`);
  execFileSync('git', ['add', 'prd.json'], { cwd: tempDir });
  execFileSync('git', ['commit', '-m', 'test: seed failed epic for rerun'], { cwd: tempDir });
  env['MOCK_RESULT_EPIC_001'] = 'PASS';
  const second = runRalph(tempDir, env);
  assert.equal(second.status, 0, `stderr: ${second.stderr}\nstdout: ${second.stdout}`);
  assert.match(second.stdout, /\[EPIC-001\] PASSED/);
});

test('US-002: a loop branch is created for the run and an epic worktree is created per epic', () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], { 'EPIC-001': 'PASS' });
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0);
  assert.match(execFileSync('git', ['branch', '--show-current'], { cwd: tempDir, encoding: 'utf-8' }).trim(), /^ralph\/loop\//);
  assert.ok(fs.existsSync(path.join(tempDir, '.ralph-teams', '.worktrees')));
});

test('US-002: worktrees are cleaned up after wave completes', () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], { 'EPIC-001': 'PASS' });
  runRalph(tempDir, env);
  const worktreeDir = path.join(tempDir, '.ralph-teams', '.worktrees', 'EPIC-001');
  assert.ok(!fs.existsSync(worktreeDir));
});

test('US-002: stale unregistered worktree directory is removed automatically', () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], { 'EPIC-001': 'PASS' });
  const stale = path.join(tempDir, '.ralph-teams', '.worktrees', 'EPIC-001');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'stale.txt'), 'x\n');
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(!fs.existsSync(stale));
});

test('US-002: a transient worktree creation failure is retried automatically', () => {
  const { tempDir, binDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], { 'EPIC-001': 'PASS' });
  const realGit = execFileSync('which', ['git'], { encoding: 'utf-8' }).trim();
  const marker = path.join(tempDir, 'git-once.txt');
  const mockGit = [
    '#!/bin/sh',
    `REAL_GIT='${realGit}'`,
    `MARKER='${marker}'`,
    'if [ "$1" = "worktree" ] && [ "$2" = "add" ] && [ ! -f "$MARKER" ]; then',
    '  touch "$MARKER"',
    '  echo "fatal: simulated transient worktree add failure" >&2',
    '  exit 1',
    'fi',
    'exec "$REAL_GIT" "$@"',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'git'), `${mockGit}\n`);
  fs.chmodSync(path.join(binDir, 'git'), 0o755);
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.ok(fs.existsSync(marker), 'expected transient worktree failure hook to run once');
});

test('US-002: two independent epics each get separate log files', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }, { id: 'EPIC-002', title: 'Beta' }],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );
  runRalph(tempDir, env);
  const logsDir = path.join(tempDir, '.ralph-teams', 'logs');
  const logs = fs.readdirSync(logsDir).filter(name => name.startsWith('epic-'));
  assert.ok(logs.some(name => name.includes('EPIC-001')));
  assert.ok(logs.some(name => name.includes('EPIC-002')));
});

test('US-002: epics in a wave run in parallel (both finish)', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }, { id: 'EPIC-002', title: 'Beta' }],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );
  const result = runRalph(tempDir, env, ['--parallel', '2']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /Wave 1/);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  assert.match(result.stdout, /\[EPIC-002\] PASSED/);
});

test('US-002: PRD completion advances even if backend session lingers', () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], { 'EPIC-001': 'PASS' });
  env['MOCK_HANG_EPIC_001'] = '1';
  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
});

test('US-003: --parallel flag is parsed and shown in banner', () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], { 'EPIC-001': 'PASS' });
  const result = runRalph(tempDir, env, ['--parallel', '2']);
  assert.match(result.stdout, /Wave 1 — 1 epic\(s\), 2 at a time/);
});

test('US-003: default (no --parallel) stays sequential', () => {
  const { tempDir, env } = setupMultiEpicRepo([{ id: 'EPIC-001', title: 'Alpha' }], { 'EPIC-001': 'PASS' });
  const result = runRalph(tempDir, env);
  assert.match(result.stdout, /1 epic\(s\) remaining to run sequentially/);
});

test('US-003: --parallel 1 runs all epics in wave sequentially and all pass', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }, { id: 'EPIC-002', title: 'Beta' }],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );
  const result = runRalph(tempDir, env, ['--parallel', '1']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /Wave 1 — 2 epic\(s\), 1 at a time/);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  assert.match(result.stdout, /\[EPIC-002\] PASSED/);
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
  const result = runRalph(tempDir, env, ['--parallel', '2', '--max-epics', '3']);
  const passedCount = (result.stdout.match(/PASSED/g) ?? []).length;
  assert.ok(passedCount <= 3, `Expected at most 3 PASSEDs, got ${passedCount}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /Reached max epics limit/);
});
