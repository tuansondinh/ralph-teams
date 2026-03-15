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
