import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const jsonToolPath = path.resolve('src/json-tool.ts');

function extractStreamText(input: string): string {
  const result = spawnSync(process.execPath, ['--import', 'tsx', jsonToolPath, 'extract-stream-text'], {
    input,
    encoding: 'utf-8',
  });
  assert.equal(result.status, 0);
  return result.stdout.trim();
}

test('extract-stream-text returns assistant text lines', () => {
  const output = extractStreamText(JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    },
  }));

  assert.equal(output, 'hello\nworld');
});

test('extract-stream-text returns generic error messages from API error envelopes', () => {
  const output = extractStreamText(JSON.stringify({
    error: { message: 'Rate limit reached for requests' },
    statusCode: 429,
  }));

  assert.equal(output, 'ERROR: Rate limit reached for requests');
});

test('extract-stream-text returns nested responseBody error messages', () => {
  const output = extractStreamText(JSON.stringify({
    responseBody: JSON.stringify({
      error: { message: 'Provider temporarily unavailable' },
    }),
  }));

  assert.equal(output, 'ERROR: Provider temporarily unavailable');
});
