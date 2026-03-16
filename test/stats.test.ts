import test from 'node:test';
import assert from 'node:assert/strict';
import { statsCommand, StatsDeps } from '../src/commands/stats';

test('statsCommand reports that statistics are temporarily disabled', () => {
  const lines: string[] = [];
  const deps: StatsDeps = {
    log: (msg: string) => lines.push(msg),
  };

  statsCommand('./ralph-run-stats.json', deps);

  assert.deepEqual(lines, ['Statistics are temporarily disabled.']);
});
