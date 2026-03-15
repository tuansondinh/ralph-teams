import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const repoRoot = '/Users/sonwork/Workspace/ralph-team-agents';
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
    '  if [ -n "$RESULT_VAL" ]; then',
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

  // The branch ralph/EPIC-001 should exist after execution
  const branches = execFileSync('git', ['branch'], { cwd: tempDir, encoding: 'utf-8' });
  assert.match(branches, /ralph\/EPIC-001/);
});

test('US-002: worktrees are cleaned up after wave completes', () => {
  const { tempDir, env } = setupMultiEpicRepo(
    [{ id: 'EPIC-001', title: 'Alpha' }],
    { 'EPIC-001': 'PASS' },
  );

  runRalph(tempDir, env);

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
