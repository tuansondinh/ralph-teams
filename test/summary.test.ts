import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseWavesFromProgress } from '../src/commands/summary';

// Sample progress.txt that mirrors ralph.sh output format
const SAMPLE_PROGRESS = `# Ralph Progress Log
Started: Mon Jan 01 00:00:00 UTC 2024
PRD: prd.json
---

=== Wave 1 — Mon Jan 01 00:00:01 UTC 2024 ===
  EPIC-001
  EPIC-002
[EPIC-001] PASSED — Mon Jan 01 00:01:00 UTC 2024
[EPIC-001] MERGED (clean) — Mon Jan 01 00:01:05 UTC 2024
[EPIC-002] PASSED — Mon Jan 01 00:01:10 UTC 2024
[EPIC-002] MERGED (AI-resolved) — Mon Jan 01 00:01:15 UTC 2024

=== Wave 2 — Mon Jan 01 00:02:00 UTC 2024 ===
  EPIC-003
[EPIC-003] PARTIAL — Mon Jan 01 00:03:00 UTC 2024 — 2/3 stories passed
`;

function writeTempProgress(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-summary-'));
  const filePath = path.join(dir, 'progress.txt');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

test('parseWavesFromProgress returns empty array when file does not exist', () => {
  const result = parseWavesFromProgress('/nonexistent/path/progress.txt');
  assert.deepEqual(result, []);
});

test('parseWavesFromProgress returns empty array when file has no wave data', () => {
  const filePath = writeTempProgress('# Ralph Progress Log\nStarted: somedate\n---\n');
  const result = parseWavesFromProgress(filePath);
  assert.deepEqual(result, []);
});

test('parseWavesFromProgress extracts correct wave count', () => {
  const filePath = writeTempProgress(SAMPLE_PROGRESS);
  const waves = parseWavesFromProgress(filePath);
  assert.equal(waves.length, 2);
});

test('parseWavesFromProgress extracts wave numbers correctly', () => {
  const filePath = writeTempProgress(SAMPLE_PROGRESS);
  const waves = parseWavesFromProgress(filePath);
  assert.equal(waves[0]?.waveNumber, 1);
  assert.equal(waves[1]?.waveNumber, 2);
});

test('parseWavesFromProgress extracts epic IDs per wave', () => {
  const filePath = writeTempProgress(SAMPLE_PROGRESS);
  const waves = parseWavesFromProgress(filePath);
  assert.deepEqual(waves[0]?.epicIds, ['EPIC-001', 'EPIC-002']);
  assert.deepEqual(waves[1]?.epicIds, ['EPIC-003']);
});

test('parseWavesFromProgress extracts results per wave', () => {
  const filePath = writeTempProgress(SAMPLE_PROGRESS);
  const waves = parseWavesFromProgress(filePath);

  const wave1Results = waves[0]?.results ?? [];
  assert.equal(wave1Results.length, 4); // PASSED + MERGED for EPIC-001, PASSED + MERGED for EPIC-002
  assert.equal(wave1Results[0]?.epicId, 'EPIC-001');
  assert.equal(wave1Results[0]?.outcome, 'PASSED');
  assert.equal(wave1Results[1]?.epicId, 'EPIC-001');
  assert.equal(wave1Results[1]?.outcome, 'MERGED (clean)');
  assert.equal(wave1Results[2]?.epicId, 'EPIC-002');
  assert.equal(wave1Results[2]?.outcome, 'PASSED');
  assert.equal(wave1Results[3]?.epicId, 'EPIC-002');
  assert.equal(wave1Results[3]?.outcome, 'MERGED (AI-resolved)');
});

test('parseWavesFromProgress extracts results for wave 2', () => {
  const filePath = writeTempProgress(SAMPLE_PROGRESS);
  const waves = parseWavesFromProgress(filePath);

  const wave2Results = waves[1]?.results ?? [];
  assert.equal(wave2Results.length, 1);
  assert.equal(wave2Results[0]?.epicId, 'EPIC-003');
  assert.equal(wave2Results[0]?.outcome, 'PARTIAL');
});

test('parseWavesFromProgress handles MERGE FAILED outcome', () => {
  const content = `
=== Wave 1 — somedate ===
  EPIC-001
[EPIC-001] MERGE FAILED (AI resolution failed, files: src/foo.ts) — somedate
`;
  const filePath = writeTempProgress(content);
  const waves = parseWavesFromProgress(filePath);
  assert.equal(waves.length, 1);
  assert.equal(waves[0]?.results[0]?.outcome, 'MERGE FAILED (AI resolution failed, files: src/foo.ts)');
});

test('parseWavesFromProgress handles single-epic wave', () => {
  const content = `
=== Wave 1 — somedate ===
  EPIC-001
[EPIC-001] PASSED — somedate
`;
  const filePath = writeTempProgress(content);
  const waves = parseWavesFromProgress(filePath);
  assert.equal(waves[0]?.epicIds.length, 1);
  assert.equal(waves[0]?.epicIds[0], 'EPIC-001');
});
