/**
 * test/dashboard-activity.test.ts — Tests for agent log activity parsing.
 *
 * Tests tool-call activity extraction, log tail reading, and the
 * parseLatestActivity dispatcher for both claude and copilot backends.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  toolCallToActivity,
  parseStreamJsonLine,
  parseStreamJsonTextLine,
  parseCopilotLine,
  parseLatestActivity,
  readLogTail,
  findLatestEpicLog,
  resetSpinner,
} from '../src/dashboard/activity-parser';

// Reset spinner before each run to keep tests deterministic
function withResetSpinner<T>(fn: () => T): T {
  resetSpinner();
  return fn();
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Builds a stream-json assistant line with a tool_use content block. */
function toolUseLine(toolName: string, input: Record<string, unknown>, timestamp?: string): string {
  const obj: Record<string, unknown> = {
    type: 'assistant',
    uuid: 'test-uuid-1',
    message: {
      id: 'msg-1',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: toolName,
          input,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };
  if (timestamp) obj['timestamp'] = timestamp;
  return JSON.stringify(obj);
}

/** Builds a stream-json assistant line with a text content block. */
function textLine(text: string, timestamp?: string): string {
  const obj: Record<string, unknown> = {
    type: 'assistant',
    uuid: 'test-text-uuid-1',
    message: {
      id: 'msg-text-1',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };
  if (timestamp) obj['timestamp'] = timestamp;
  return JSON.stringify(obj);
}

/** Builds an assistant line with usage but no tool_use (token counting line). */
function usageLine(uuid: string): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    message: {
      role: 'assistant',
      content: [],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  });
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-activity-'));
}

// ---------------------------------------------------------------------------
// toolCallToActivity — file editing tools
// ---------------------------------------------------------------------------

test('toolCallToActivity returns "editing <basename>" for Edit tool', () => {
  assert.equal(
    toolCallToActivity('Edit', { file_path: 'src/api.ts' }),
    'editing api.ts',
  );
});

test('toolCallToActivity returns "editing <basename>" for Write tool', () => {
  assert.equal(
    toolCallToActivity('Write', { file_path: '/abs/path/to/component.tsx' }),
    'editing component.tsx',
  );
});

test('toolCallToActivity returns "editing <basename>" for MultiEdit tool', () => {
  assert.equal(
    toolCallToActivity('MultiEdit', { file_path: 'src/utils/helper.ts' }),
    'editing helper.ts',
  );
});

test('toolCallToActivity returns "editing file" when no path provided', () => {
  assert.equal(toolCallToActivity('Edit', {}), 'editing file');
});

// ---------------------------------------------------------------------------
// toolCallToActivity — read tool
// ---------------------------------------------------------------------------

test('toolCallToActivity returns "reading <basename>" for Read tool', () => {
  assert.equal(
    toolCallToActivity('Read', { file_path: 'src/config.ts' }),
    'reading config.ts',
  );
});

// ---------------------------------------------------------------------------
// toolCallToActivity — bash tool: test runs
// ---------------------------------------------------------------------------

test('toolCallToActivity returns "running tests" for npm test', () => {
  assert.equal(
    toolCallToActivity('Bash', { command: 'npm test' }),
    'running tests',
  );
});

test('toolCallToActivity returns "running tests" for jest', () => {
  assert.equal(
    toolCallToActivity('Bash', { command: 'npx jest --coverage' }),
    'running tests',
  );
});

test('toolCallToActivity returns "running tests" for node --test', () => {
  assert.equal(
    toolCallToActivity('Bash', { command: 'node --import tsx --test test/**/*.test.ts' }),
    'running tests',
  );
});

test('toolCallToActivity returns "running tests" for deno test', () => {
  assert.equal(
    toolCallToActivity('Bash', { command: 'deno test --allow-net' }),
    'running tests',
  );
});

// ---------------------------------------------------------------------------
// toolCallToActivity — bash tool: git operations
// ---------------------------------------------------------------------------

test('toolCallToActivity returns "committing" for git commit', () => {
  assert.equal(
    toolCallToActivity('Bash', { command: 'git commit -m "feat: add feature"' }),
    'committing',
  );
});

test('toolCallToActivity returns "staging files" for git add', () => {
  assert.equal(
    toolCallToActivity('Bash', { command: 'git add src/api.ts' }),
    'staging files',
  );
});

// ---------------------------------------------------------------------------
// toolCallToActivity — bash tool: install
// ---------------------------------------------------------------------------

test('toolCallToActivity returns "installing deps" for npm install', () => {
  assert.equal(
    toolCallToActivity('Bash', { command: 'npm install blessed' }),
    'installing deps',
  );
});

// ---------------------------------------------------------------------------
// toolCallToActivity — bash tool: generic command
// ---------------------------------------------------------------------------

test('toolCallToActivity returns "running: <preview>" for generic bash command', () => {
  const result = toolCallToActivity('Bash', { command: 'ls -la src/' });
  assert.ok(result.startsWith('running: ls'), `expected "running: ls...", got "${result}"`);
});

test('toolCallToActivity truncates long commands to 40 chars', () => {
  const longCmd = 'a'.repeat(60);
  const result = toolCallToActivity('Bash', { command: longCmd });
  assert.ok(result.startsWith('running: '));
  // 'running: ' is 9 chars + up to 40 chars of command = 49 max
  assert.ok(result.length <= 49, `command preview too long: ${result.length}`);
});

// ---------------------------------------------------------------------------
// toolCallToActivity — other tools
// ---------------------------------------------------------------------------

test('toolCallToActivity returns "searching files" for Glob tool', () => {
  assert.equal(toolCallToActivity('Glob', {}), 'searching files');
});

test('toolCallToActivity returns "spawning agent" for Agent tool', () => {
  assert.equal(toolCallToActivity('Agent', {}), 'spawning agent');
});

test('toolCallToActivity returns "using <name>" for unknown tools', () => {
  assert.equal(toolCallToActivity('SomeCustomTool', {}), 'using SomeCustomTool');
});

// ---------------------------------------------------------------------------
// parseStreamJsonLine
// ---------------------------------------------------------------------------

test('parseStreamJsonLine returns null for empty string', () => {
  assert.equal(parseStreamJsonLine(''), null);
});

test('parseStreamJsonLine returns null for non-assistant lines', () => {
  const userLine = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } });
  assert.equal(parseStreamJsonLine(userLine), null);
});

test('parseStreamJsonLine returns null for assistant line without tool_use', () => {
  assert.equal(parseStreamJsonLine(usageLine('uuid-1')), null);
});

test('parseStreamJsonLine extracts Edit tool activity', () => {
  const line = toolUseLine('Edit', { file_path: 'src/main.ts' });
  const result = parseStreamJsonLine(line);
  assert.ok(result !== null);
  assert.equal(result.activity, 'editing main.ts');
});

test('parseStreamJsonLine extracts Bash test activity', () => {
  const line = toolUseLine('Bash', { command: 'npm test' });
  const result = parseStreamJsonLine(line);
  assert.ok(result !== null);
  assert.equal(result.activity, 'running tests');
});

test('parseStreamJsonLine returns null for malformed JSON', () => {
  assert.equal(parseStreamJsonLine('{not valid json'), null);
});

test('parseStreamJsonLine extracts timestamp when present', () => {
  const ts = '2024-01-01T00:00:00Z';
  const line = toolUseLine('Edit', { file_path: 'foo.ts' }, ts);
  const result = parseStreamJsonLine(line);
  assert.ok(result !== null);
  assert.ok(result.timestampMs !== null);
  assert.equal(result.timestampMs, new Date(ts).getTime());
});

test('parseStreamJsonLine returns null timestampMs when no timestamp in line', () => {
  const line = toolUseLine('Edit', { file_path: 'foo.ts' });
  const result = parseStreamJsonLine(line);
  assert.ok(result !== null);
  assert.equal(result.timestampMs, null);
});

test('parseStreamJsonTextLine extracts assistant text output', () => {
  const line = textLine('Planning next step');
  const result = parseStreamJsonTextLine(line);
  assert.ok(result !== null);
  assert.equal(result.activity, 'Planning next step');
});

test('parseStreamJsonTextLine returns the last non-empty text line', () => {
  const line = textLine('First line\n\nSecond line');
  const result = parseStreamJsonTextLine(line);
  assert.ok(result !== null);
  assert.equal(result.activity, 'Second line');
});

// ---------------------------------------------------------------------------
// parseCopilotLine
// ---------------------------------------------------------------------------

test('parseCopilotLine returns null for unrecognized lines', () => {
  assert.equal(parseCopilotLine('some random output'), null);
  assert.equal(parseCopilotLine(''), null);
});

test('parseCopilotLine detects "running tests" from npm test mention', () => {
  assert.equal(parseCopilotLine('Running npm test...'), 'running tests');
});

test('parseCopilotLine detects "committing" from git commit', () => {
  assert.equal(parseCopilotLine('Running git commit -m "fix"'), 'committing');
});

test('parseCopilotLine detects "editing file" from "editing file:" pattern', () => {
  const result = parseCopilotLine('Editing file: src/api.ts');
  assert.ok(result !== null);
  assert.ok(result.includes('editing'));
});

// ---------------------------------------------------------------------------
// parseLatestActivity — claude backend
// ---------------------------------------------------------------------------

test('parseLatestActivity returns idle spinner for empty log', () => {
  withResetSpinner(() => {
    const result = parseLatestActivity('', 'claude');
    assert.ok(result.startsWith('idle '), `expected idle spinner, got "${result}"`);
  });
});

test('parseLatestActivity returns idle spinner for log with no text or tool_use', () => {
  withResetSpinner(() => {
    const log = [usageLine('uuid-1'), usageLine('uuid-2')].join('\n');
    const result = parseLatestActivity(log, 'claude');
    assert.ok(result.startsWith('idle '));
  });
});

test('parseLatestActivity returns most recent assistant text output', () => {
  withResetSpinner(() => {
    const log = [
      toolUseLine('Edit', { file_path: 'src/old.ts' }),
      textLine('Validator running'),
      textLine('Builder finished US-001'),
    ].join('\n');
    const result = parseLatestActivity(log, 'claude');
    assert.equal(result, 'Builder finished US-001');
  });
});

test('parseLatestActivity falls back to tool activity when no assistant text is present', () => {
  withResetSpinner(() => {
    const log = [
      toolUseLine('Edit', { file_path: 'src/api.ts' }),
      usageLine('uuid-2'),
    ].join('\n');
    const result = parseLatestActivity(log, 'claude');
    assert.equal(result, 'editing api.ts');
  });
});

test('parseLatestActivity keeps showing assistant text even when older than 30s', () => {
  withResetSpinner(() => {
    const staleTs = new Date(Date.now() - 60_000).toISOString();
    const log = textLine('Still working through validator feedback', staleTs);
    const result = parseLatestActivity(log, 'claude');
    assert.equal(result, 'Still working through validator feedback');
  });
});

test('parseLatestActivity still falls back to fresh tool activity', () => {
  withResetSpinner(() => {
    const freshTs = new Date(Date.now() - 5_000).toISOString();
    const log = toolUseLine('Edit', { file_path: 'fresh.ts' }, freshTs);
    const result = parseLatestActivity(log, 'claude');
    assert.equal(result, 'editing fresh.ts');
  });
});

// ---------------------------------------------------------------------------
// parseLatestActivity — copilot backend
// ---------------------------------------------------------------------------

test('parseLatestActivity returns idle spinner for empty copilot log', () => {
  withResetSpinner(() => {
    const result = parseLatestActivity('', 'copilot');
    assert.ok(result.startsWith('idle '));
  });
});

test('parseLatestActivity returns the latest visible line from copilot text log', () => {
  withResetSpinner(() => {
    const log = 'Some output\nRunning npm test\nDone';
    const result = parseLatestActivity(log, 'copilot');
    assert.equal(result, 'Done');
  });
});

// ---------------------------------------------------------------------------
// readLogTail
// ---------------------------------------------------------------------------

test('readLogTail returns empty string for non-existent file', () => {
  const result = readLogTail('/nonexistent/path/to/log.txt');
  assert.equal(result, '');
});

test('readLogTail returns all content for small files', () => {
  const tempDir = makeTempDir();
  const logPath = path.join(tempDir, 'test.log');
  const content = 'line1\nline2\nline3\n';
  fs.writeFileSync(logPath, content);

  const result = readLogTail(logPath);
  assert.ok(result.includes('line1'), 'should include line1');
  assert.ok(result.includes('line2'), 'should include line2');
  assert.ok(result.includes('line3'), 'should include line3');
});

test('readLogTail respects lineCount parameter', () => {
  const tempDir = makeTempDir();
  const logPath = path.join(tempDir, 'test.log');
  // Write 20 lines
  const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
  fs.writeFileSync(logPath, lines + '\n');

  const result = readLogTail(logPath, 5);
  const resultLines = result.split('\n').filter(l => l.trim());
  assert.ok(resultLines.length <= 5, `expected ≤5 lines, got ${resultLines.length}`);
  // Should have the last 5 lines
  assert.ok(result.includes('line20'), 'should include last line');
  assert.ok(!result.includes('line1\n') || result.indexOf('line1') > result.indexOf('line15'),
    'line1 should not be in first position (if present at all)');
});

test('readLogTail reads only the tail for large files', () => {
  const tempDir = makeTempDir();
  const logPath = path.join(tempDir, 'large.log');

  // Write a file larger than 8KB
  const lineCount = 500;
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(`{"line": ${i}, "data": "${'x'.repeat(30)}"}`);
  }
  fs.writeFileSync(logPath, lines.join('\n') + '\n');

  const stat = fs.statSync(logPath);
  assert.ok(stat.size > 8192, 'test file should be >8KB');

  const result = readLogTail(logPath, 50);
  const resultLines = result.split('\n').filter(l => l.trim());

  // Should not have the first line (well outside the 8KB tail)
  assert.ok(!result.includes('"line": 0,'), 'should NOT include line 0 (too far from end)');
  // Should have near the last line
  assert.ok(result.includes(`"line": ${lineCount - 1}`), 'should include last line');
  assert.ok(resultLines.length <= 50, `expected ≤50 lines, got ${resultLines.length}`);
});

test('readLogTail returns empty string for empty file', () => {
  const tempDir = makeTempDir();
  const logPath = path.join(tempDir, 'empty.log');
  fs.writeFileSync(logPath, '');

  assert.equal(readLogTail(logPath), '');
});

// ---------------------------------------------------------------------------
// findLatestEpicLog
// ---------------------------------------------------------------------------

test('findLatestEpicLog returns null when logs directory does not exist', () => {
  assert.equal(findLatestEpicLog('/nonexistent/logs', 'EPIC-001'), null);
});

test('findLatestEpicLog returns null when no matching log files exist', () => {
  const tempDir = makeTempDir();
  assert.equal(findLatestEpicLog(tempDir, 'EPIC-001'), null);
});

test('findLatestEpicLog returns the matching log file', () => {
  const tempDir = makeTempDir();
  const logFile = path.join(tempDir, 'epic-EPIC-001-1700000000.log');
  fs.writeFileSync(logFile, 'log content');

  const result = findLatestEpicLog(tempDir, 'EPIC-001');
  assert.equal(result, `${tempDir}/epic-EPIC-001-1700000000.log`);
});

test('findLatestEpicLog returns the most recent log when multiple exist', () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, 'epic-EPIC-001-1700000001.log'), 'old');
  fs.writeFileSync(path.join(tempDir, 'epic-EPIC-001-1700000002.log'), 'newer');
  fs.writeFileSync(path.join(tempDir, 'epic-EPIC-001-1700000003.log'), 'newest');

  const result = findLatestEpicLog(tempDir, 'EPIC-001');
  assert.ok(result?.includes('1700000003'), `expected newest log, got ${result}`);
});

test('findLatestEpicLog does not return logs for other epics', () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, 'epic-EPIC-002-1700000000.log'), 'other epic');

  assert.equal(findLatestEpicLog(tempDir, 'EPIC-001'), null);
});

test('findLatestEpicLog does not return merge log files', () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, 'merge-EPIC-001-1700000000.log'), 'merge log');

  assert.equal(findLatestEpicLog(tempDir, 'EPIC-001'), null);
});
