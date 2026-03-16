import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'ralph.sh');

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

test('ralph.sh asks before auto-committing and aborts when declined', () => {
  const { tempDir, binDir } = setupTempRepo();
  const result = spawnSync('bash', [scriptPath, 'prd.json'], {
    cwd: tempDir,
    input: 'n\n',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Ralph will now stage and commit all current changes before the run\./);
  assert.match(result.stdout, /Proceed with auto-commit before continuing\? \[y\/N\]: /);
  assert.match(result.stdout, /Aborted: user declined auto-commit before run\./);
  assert.match(execFileSync('git', ['status', '--short'], { cwd: tempDir, encoding: 'utf-8' }), /^ M README\.md$/m);
});

test('ralph.sh auto-commits dirty changes after confirmation and continues', () => {
  const { tempDir, binDir } = setupTempRepo();
  const result = spawnSync('bash', [scriptPath, 'prd.json'], {
    cwd: tempDir,
    input: 'y\n',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Proceed with auto-commit before continuing\? \[y\/N\]: /);
  assert.match(result.stdout, /Switching to branch: feature\/test-run/);
  assert.match(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: tempDir, encoding: 'utf-8' }), /chore: auto-commit changes before ralph run/);
  assert.equal(execFileSync('git', ['status', '--short'], { cwd: tempDir, encoding: 'utf-8' }).trim(), '');
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: tempDir, encoding: 'utf-8' }).trim(), 'feature/test-run');
});

// ─── US-001: Wave Computation Helpers ────────────────────────────────────────

/**
 * Create a temp git repo with a smart mock claude binary.
 * resultMap maps epic ID -> result string (e.g. 'PASS', 'FAIL: ...')
 * Epics not in the map get no result file (treated as failure by ralph).
 */
function setupMultiEpicRepo(
  epics: Array<{ id: string; title: string; status?: string; dependsOn?: string[] }>,
  resultMap: Record<string, string> = {},
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-wave-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

  // Smart mock claude: reads stdin, extracts epic ID, writes result file via env vars
  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'if [ -n "$EPIC_ID" ]; then',
    '  ENV_KEY="MOCK_RESULT_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  RESULT_VAL=$(printenv "$ENV_KEY" 2>/dev/null || true)',
    '  HANG_KEY="MOCK_HANG_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  HANG_VAL=$(printenv "$HANG_KEY" 2>/dev/null || true)',
    '  if [ -n "$RESULT_VAL" ]; then',
    '    mkdir -p results',
    '    printf "%s\\n" "$RESULT_VAL" > "results/result-${EPIC_ID}.txt"',
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
  };
  for (const [epicId, result] of Object.entries(resultMap)) {
    const envKey = `MOCK_RESULT_${epicId.replace(/-/g, '_')}`;
    env[envKey] = result;
  }

  return { tempDir, binDir, env };
}

function runRalph(tempDir: string, env: Record<string, string>, args: string[] = []) {
  return spawnSync('bash', [scriptPath, 'prd.json', ...args], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
  });
}

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

  // Both epics should appear in wave 1
  assert.match(result.stdout, /Wave 1 — 2 epic\(s\)/);
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

  // Should have two separate waves
  assert.match(result.stdout, /Wave 1 — 1 epic\(s\)/);
  assert.match(result.stdout, /Wave 2 — 1 epic\(s\)/);

  // EPIC-001 in wave 1, EPIC-002 in wave 2
  const wave1Pos = result.stdout.indexOf('Wave 1');
  const wave2Pos = result.stdout.indexOf('Wave 2');
  const epic1Pos = result.stdout.indexOf('[EPIC-001] PASSED');
  const epic2Pos = result.stdout.indexOf('[EPIC-002] PASSED');
  assert.ok(wave1Pos < epic1Pos && epic1Pos < wave2Pos, 'EPIC-001 should complete before Wave 2 starts');
  assert.ok(wave2Pos < epic2Pos, 'EPIC-002 should complete in Wave 2');
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
      { id: 'EPIC-001', title: 'Alpha' },          // will fail (no result file)
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },  // should be skipped
      { id: 'EPIC-003', title: 'Gamma' },           // independent — should pass
    ],
    { 'EPIC-003': 'PASS' },  // EPIC-001 gets no result → fails; EPIC-002 skipped; EPIC-003 passes
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

  runRalph(tempDir, env);

  const progress = fs.readFileSync(path.join(tempDir, 'progress.txt'), 'utf-8');
  assert.match(progress, /=== Wave 1 —/);
  assert.match(progress, /=== Wave 2 —/);
  assert.match(progress, /EPIC-001/);
  assert.match(progress, /EPIC-002/);
});

// ─── US-002 Tests ─────────────────────────────────────────────────────────────

test('US-002: worktree and branch are created per epic', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    { 'EPIC-001': 'PASS' },
  );

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  // Ralph should report spawning the epic in a worktree (branch creation is logged)
  assert.match(result.stdout, /Spawning \[EPIC-001\] in worktree/);
  // The epic should complete (confirming the worktree + branch were usable)
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
});

test('US-002: worktrees are cleaned up after wave completes', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    { 'EPIC-001': 'PASS' },
  );

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  // .worktrees/EPIC-001 should NOT exist after cleanup
  assert.equal(fs.existsSync(path.join(tempDir, '.worktrees', 'EPIC-001')), false);
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

  const logsDir = path.join(tempDir, 'logs');
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

  const result = runRalph(tempDir, env);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);

  // All three should be spawned in Wave 1 (no deps)
  assert.match(result.stdout, /Wave 1 — 3 epic\(s\)/);
  assert.match(result.stdout, /\[EPIC-001\] PASSED/);
  assert.match(result.stdout, /\[EPIC-002\] PASSED/);
  assert.match(result.stdout, /\[EPIC-003\] PASSED/);
});

test('US-002: result file completion advances even if backend session lingers', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [
      { id: 'EPIC-001', title: 'Alpha' },
      { id: 'EPIC-002', title: 'Beta', dependsOn: ['EPIC-001'] },
    ],
    { 'EPIC-001': 'PASS', 'EPIC-002': 'PASS' },
  );

  env.MOCK_HANG_EPIC_001 = '1';

  const result = spawnSync('bash', [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 5000,
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
 * so they can be cleanly merged back to main. Uses a mock claude that writes
 * result files AND creates a commit on the epic branch before reporting.
 */
function setupMergeRepo(
  epics: Array<{ id: string; title: string; fileName: string }>,
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-merge-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

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

  // Mock claude: creates a unique file on the epic branch, then writes PASS result
  // This ensures each epic branch has a distinct commit that can be cleanly merged
  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'if [ -n "$EPIC_ID" ]; then',
    '  ENV_KEY="MOCK_FILE_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  FILE_NAME=$(printenv "$ENV_KEY" 2>/dev/null || true)',
    '  if [ -n "$FILE_NAME" ]; then',
    '    printf "content for %s\\n" "$EPIC_ID" > "$FILE_NAME"',
    '    git add "$FILE_NAME"',
    '    git commit -m "feat: add $FILE_NAME for $EPIC_ID"',
    '  fi',
    '  mkdir -p results',
    '  printf "PASS\\n" > "results/result-${EPIC_ID}.txt"',
    'fi',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'claude'), mockClaude);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
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

  const progress = fs.readFileSync(path.join(tempDir, 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] MERGED/);
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
  const logsDir = path.join(tempDir, 'logs');
  if (fs.existsSync(logsDir)) {
    const mergeLogs = fs.readdirSync(logsDir).filter((f) => f.startsWith('merge-'));
    assert.equal(mergeLogs.length, 0, 'clean merge should not create a merge agent log');
  }
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

  const progress = fs.readFileSync(path.join(tempDir, 'progress.txt'), 'utf-8');
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
function setupConflictRepo() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-conflict-'));
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(binDir);

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
  // AND creates a conflicting commit on main. When acting as merger agent, does nothing.
  // The result file is written regardless, so EPIC-001 reports PASS.
  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
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
    '  mkdir -p results',
    '  printf "PASS\\n" > "results/result-${EPIC_ID}.txt"',
    'fi',
    '# When called as merger agent (no WORKTREE), just exit without resolving',
    'exit 0',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'claude'), mockClaude);
  fs.chmodSync(path.join(binDir, 'claude'), 0o755);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
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

  const progress = fs.readFileSync(path.join(tempDir, 'progress.txt'), 'utf-8');
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

  const logsDir = path.join(tempDir, 'logs');
  assert.ok(fs.existsSync(logsDir), 'logs/ directory should exist');
  const mergeLogs = fs.readdirSync(logsDir).filter((f) => f.startsWith('merge-EPIC-001'));
  assert.ok(mergeLogs.length > 0, 'merge log file should be created when agent is spawned');
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
    const proc = spawn('bash', [scriptPath, 'prd.json', ...args], {
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

  const stateFile = path.join(tempDir, 'ralph-state.json');
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
  const worktreeDir = path.join(tempDir, '.worktrees', 'EPIC-001');
  assert.ok(fs.existsSync(worktreeDir), 'worktree should be preserved after SIGINT');
});

test('US-008: ralph-state.json includes the active epic ID', { timeout: 15000 }, async () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},
  );
  env['MOCK_HANG_EPIC_001'] = '1';

  await runRalphWithSigint(tempDir, env);

  const stateFile = path.join(tempDir, 'ralph-state.json');
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

  const stateFile = path.join(tempDir, 'ralph-state.json');
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

  const stateFile = path.join(tempDir, 'ralph-state.json');
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
    {},  // No result file — mock will hang
  );
  // Make mock agent hang (sleep 30) and set a very short timeout (2s)
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_EPIC_TIMEOUT'] = '2';

  const start = Date.now();
  const result = spawnSync('bash', [scriptPath, 'prd.json'], {
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

  spawnSync('bash', [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });

  const progress = fs.readFileSync(path.join(tempDir, 'progress.txt'), 'utf-8');
  assert.match(progress, /\[EPIC-001\] FAILED \(epic timeout after 2s\)/);
});

test('US-004 (timeout): timed-out epic log file contains timeout message', { timeout: 15000 }, () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    {},
  );
  env['MOCK_HANG_EPIC_001'] = '1';
  env['RALPH_EPIC_TIMEOUT'] = '2';

  spawnSync('bash', [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });

  const logsDir = path.join(tempDir, 'logs');
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

  const result = spawnSync('bash', [scriptPath, 'prd.json', '--parallel', '2'], {
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
  // Otherwise, if MOCK_RESULT_<EPIC_ID> is set, write the result file.
  // The key difference from setupMultiEpicRepo: silent mode writes nothing to stdout,
  // so the log file has no output (simulating an idle/stuck agent).
  const mockClaude = [
    '#!/bin/sh',
    'STDIN=$(cat)',
    'EPIC_ID=$(printf "%s" "$STDIN" | grep -oE "EPIC-[0-9]+" | head -1)',
    'if [ -n "$EPIC_ID" ]; then',
    '  SILENT_KEY="MOCK_SILENT_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  SILENT_VAL=$(printenv "$SILENT_KEY" 2>/dev/null || true)',
    '  RESULT_KEY="MOCK_RESULT_$(printf "%s" "$EPIC_ID" | tr - _)"',
    '  RESULT_VAL=$(printenv "$RESULT_KEY" 2>/dev/null || true)',
    '  if [ "$SILENT_VAL" = "1" ]; then',
    '    # Sleep without writing any output — simulates idle/stuck agent',
    '    sleep 30',
    '  elif [ -n "$RESULT_VAL" ]; then',
    '    mkdir -p results',
    '    printf "%s\\n" "$RESULT_VAL" > "results/result-${EPIC_ID}.txt"',
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
  const result = spawnSync('bash', [scriptPath, 'prd.json'], {
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

test('US-005 (idle timeout): idle timeout event is logged to progress.txt', { timeout: 15000 }, () => {
  const { tempDir, env } = setupIdleTimeoutRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
  );
  env['MOCK_SILENT_EPIC_001'] = '1';
  env['RALPH_IDLE_TIMEOUT'] = '2';

  spawnSync('bash', [scriptPath, 'prd.json'], {
    cwd: tempDir,
    encoding: 'utf-8',
    env,
    timeout: 12000,
  });

  const progress = fs.readFileSync(path.join(tempDir, 'progress.txt'), 'utf-8');
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

  const result = spawnSync('bash', [scriptPath, 'prd.json', '--parallel', '2'], {
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
