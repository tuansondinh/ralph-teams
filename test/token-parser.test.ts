import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseTokenUsageFromLog, parseTokenUsageFromFile } from '../src/token-parser';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a single Claude stream-json assistant line with the given uuid and usage. */
function assistantLine(uuid: string, usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    message: {
      id: uuid,
      type: 'message',
      role: 'assistant',
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      },
    },
  });
}

/** Joins log lines with newlines. */
function makeLog(...lines: string[]): string {
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// parseTokenUsageFromLog — copilot backend
// ---------------------------------------------------------------------------

test('parseTokenUsageFromLog returns all nulls for copilot backend', () => {
  const log = assistantLine('uuid-1', { input_tokens: 100, output_tokens: 50 });
  const result = parseTokenUsageFromLog(log, 'copilot');

  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);
  assert.equal(result.cacheCreationInputTokens, null);
  assert.equal(result.cacheReadInputTokens, null);
});

// ---------------------------------------------------------------------------
// parseTokenUsageFromLog — basic claude parsing
// ---------------------------------------------------------------------------

test('parseTokenUsageFromLog sums token usage across multiple assistant messages', () => {
  const log = makeLog(
    assistantLine('uuid-1', { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 10 }),
    assistantLine('uuid-2', { input_tokens: 300, output_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 }),
  );

  const result = parseTokenUsageFromLog(log, 'claude');

  assert.equal(result.inputTokens, 400);
  assert.equal(result.outputTokens, 75);
  assert.equal(result.cacheCreationInputTokens, 200);
  assert.equal(result.cacheReadInputTokens, 60);
});

test('parseTokenUsageFromLog returns all nulls when log has no assistant messages', () => {
  const log = makeLog(
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    JSON.stringify({ type: 'system', message: 'system message' }),
  );

  const result = parseTokenUsageFromLog(log, 'claude');

  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);
  assert.equal(result.cacheCreationInputTokens, null);
  assert.equal(result.cacheReadInputTokens, null);
});

// ---------------------------------------------------------------------------
// parseTokenUsageFromLog — deduplication by uuid
// ---------------------------------------------------------------------------

test('parseTokenUsageFromLog deduplicates by uuid, keeping the last occurrence', () => {
  // uuid-1 appears twice — second occurrence has higher token counts (streaming update)
  const line1 = JSON.stringify({
    type: 'assistant',
    uuid: 'uuid-1',
    message: { id: 'uuid-1', usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
  const line2 = JSON.stringify({
    type: 'assistant',
    uuid: 'uuid-1',
    message: { id: 'uuid-1', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 10 } },
  });
  const line3 = assistantLine('uuid-2', { input_tokens: 200, output_tokens: 80 });

  const log = makeLog(line1, line2, line3);
  const result = parseTokenUsageFromLog(log, 'claude');

  // uuid-1 last occurrence: 100+50+20+10; uuid-2: 200+80+0+0
  assert.equal(result.inputTokens, 300);       // 100 + 200
  assert.equal(result.outputTokens, 130);      // 50 + 80
  assert.equal(result.cacheCreationInputTokens, 20); // 20 + 0
  assert.equal(result.cacheReadInputTokens, 10);     // 10 + 0
});

// ---------------------------------------------------------------------------
// parseTokenUsageFromLog — malformed JSON
// ---------------------------------------------------------------------------

test('parseTokenUsageFromLog handles malformed JSON lines gracefully', () => {
  const log = makeLog(
    'not valid json at all',
    '{ broken json: true',
    assistantLine('uuid-1', { input_tokens: 50, output_tokens: 25 }),
    '',
    '   ',
    '{"type": "incomplete"',
  );

  const result = parseTokenUsageFromLog(log, 'claude');

  // Should parse the one valid assistant line
  assert.equal(result.inputTokens, 50);
  assert.equal(result.outputTokens, 25);
});

// ---------------------------------------------------------------------------
// parseTokenUsageFromLog — empty input
// ---------------------------------------------------------------------------

test('parseTokenUsageFromLog returns all nulls for empty string', () => {
  const result = parseTokenUsageFromLog('', 'claude');

  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);
  assert.equal(result.cacheCreationInputTokens, null);
  assert.equal(result.cacheReadInputTokens, null);
});

test('parseTokenUsageFromLog returns all nulls for whitespace-only string', () => {
  const result = parseTokenUsageFromLog('   \n\n   ', 'claude');

  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);
});

// ---------------------------------------------------------------------------
// parseTokenUsageFromLog — non-assistant types are ignored
// ---------------------------------------------------------------------------

test('parseTokenUsageFromLog ignores non-assistant type lines even if they have usage fields', () => {
  const log = makeLog(
    JSON.stringify({ type: 'user', uuid: 'u1', message: { usage: { input_tokens: 999 } } }),
    JSON.stringify({ type: 'result', uuid: 'u2', message: { usage: { input_tokens: 888 } } }),
    assistantLine('uuid-3', { input_tokens: 10, output_tokens: 5 }),
  );

  const result = parseTokenUsageFromLog(log, 'claude');

  assert.equal(result.inputTokens, 10);
  assert.equal(result.outputTokens, 5);
});

// ---------------------------------------------------------------------------
// parseTokenUsageFromFile — file not found
// ---------------------------------------------------------------------------

test('parseTokenUsageFromFile returns all nulls when file does not exist', () => {
  const result = parseTokenUsageFromFile('/nonexistent/path/that/does/not/exist.log', 'claude');

  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);
  assert.equal(result.cacheCreationInputTokens, null);
  assert.equal(result.cacheReadInputTokens, null);
});

// ---------------------------------------------------------------------------
// parseTokenUsageFromFile — real file read
// ---------------------------------------------------------------------------

test('parseTokenUsageFromFile reads a file and parses token usage correctly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-token-'));
  const logPath = path.join(tmpDir, 'test.log');

  const logContent = makeLog(
    assistantLine('msg-1', { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 200, cache_read_input_tokens: 50 }),
    assistantLine('msg-2', { input_tokens: 2000, output_tokens: 100 }),
    JSON.stringify({ type: 'user', content: 'ignored' }),
  );

  fs.writeFileSync(logPath, logContent, 'utf-8');

  const result = parseTokenUsageFromFile(logPath, 'claude');

  assert.equal(result.inputTokens, 3000);
  assert.equal(result.outputTokens, 600);
  assert.equal(result.cacheCreationInputTokens, 200);
  assert.equal(result.cacheReadInputTokens, 50);

  fs.rmSync(tmpDir, { recursive: true });
});

test('parseTokenUsageFromFile returns all nulls for copilot backend even if file exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-token-'));
  const logPath = path.join(tmpDir, 'test.log');

  fs.writeFileSync(logPath, assistantLine('msg-1', { input_tokens: 100, output_tokens: 50 }), 'utf-8');

  const result = parseTokenUsageFromFile(logPath, 'copilot');

  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);

  fs.rmSync(tmpDir, { recursive: true });
});
