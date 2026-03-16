/**
 * test/dashboard-merge.test.ts — Tests for parseMergeEvents and parseMergeLine.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMergeEvents, parseMergeLine, mergeStatusLabel } from '../src/dashboard/merge-parser';

// ---------------------------------------------------------------------------
// parseMergeLine — single line tests
// ---------------------------------------------------------------------------

describe('parseMergeLine', () => {
  it('parses MERGED (clean) line', () => {
    const line = '[EPIC-001] MERGED (clean) — Mon Jan  1 00:00:00 UTC 2024';
    const result = parseMergeLine(line);
    assert.deepEqual(result, {
      epicId: 'EPIC-001',
      status: 'merged-clean',
      detail: 'clean',
    });
  });

  it('parses MERGED (AI-resolved) line', () => {
    const line = '[EPIC-002] MERGED (AI-resolved) — Tue Jan  2 00:00:00 UTC 2024';
    const result = parseMergeLine(line);
    assert.deepEqual(result, {
      epicId: 'EPIC-002',
      status: 'merged-ai',
      detail: 'AI-resolved',
    });
  });

  it('parses merge conflicts — attempting AI resolution line', () => {
    const line = '[EPIC-003] merge conflicts — attempting AI resolution — Wed Jan  3 00:00:00 UTC 2024';
    const result = parseMergeLine(line);
    assert.deepEqual(result, {
      epicId: 'EPIC-003',
      status: 'merging',
      detail: 'resolving conflicts',
    });
  });

  it('parses MERGE FAILED with file list', () => {
    const line = '[EPIC-004] MERGE FAILED (AI resolution failed, files: src/api.ts src/utils.ts) — Thu Jan  4 00:00:00 UTC 2024';
    const result = parseMergeLine(line);
    assert.deepEqual(result, {
      epicId: 'EPIC-004',
      status: 'merge-failed',
      detail: 'src/api.ts src/utils.ts',
    });
  });

  it('parses MERGE FAILED with no file list', () => {
    const line = '[EPIC-005] MERGE FAILED (AI resolution failed) — Fri Jan  5 00:00:00 UTC 2024';
    const result = parseMergeLine(line);
    assert.equal(result?.epicId, 'EPIC-005');
    assert.equal(result?.status, 'merge-failed');
  });

  it('is case-insensitive for MERGED (clean)', () => {
    const line = '[EPIC-001] merged (clean) — date';
    const result = parseMergeLine(line);
    assert.equal(result?.status, 'merged-clean');
  });

  it('returns null for non-merge lines', () => {
    assert.equal(parseMergeLine('[EPIC-001] PASSED US-001'), null);
    assert.equal(parseMergeLine('=== Wave 2'), null);
    assert.equal(parseMergeLine(''), null);
    assert.equal(parseMergeLine('   '), null);
  });

  it('handles epic IDs with hyphens and numbers', () => {
    const line = '[EPIC-123] MERGED (clean) — date';
    const result = parseMergeLine(line);
    assert.equal(result?.epicId, 'EPIC-123');
  });
});

// ---------------------------------------------------------------------------
// parseMergeEvents — multi-line tests
// ---------------------------------------------------------------------------

describe('parseMergeEvents', () => {
  it('returns empty array for empty content', () => {
    assert.deepEqual(parseMergeEvents(''), []);
  });

  it('returns empty array for whitespace-only content', () => {
    assert.deepEqual(parseMergeEvents('   \n   \n'), []);
  });

  it('returns empty array for content with no merge lines', () => {
    const content = [
      '[EPIC-001] PASSED US-001 — some date',
      '=== Wave 1 — date',
      '[EPIC-002] FAILED US-002 — some date',
    ].join('\n');
    assert.deepEqual(parseMergeEvents(content), []);
  });

  it('parses a single clean merge', () => {
    const content = '[EPIC-001] MERGED (clean) — Mon Jan  1 00:00:00 UTC 2024';
    const result = parseMergeEvents(content);
    assert.equal(result.length, 1);
    assert.equal(result[0].epicId, 'EPIC-001');
    assert.equal(result[0].status, 'merged-clean');
  });

  it('parses multiple merge events for different epics', () => {
    const content = [
      '[EPIC-001] MERGED (clean) — date1',
      '[EPIC-002] MERGED (AI-resolved) — date2',
      '[EPIC-003] MERGE FAILED (AI resolution failed, files: a.ts) — date3',
    ].join('\n');
    const result = parseMergeEvents(content);
    assert.equal(result.length, 3);
    const ids = result.map(e => e.epicId);
    assert.ok(ids.includes('EPIC-001'));
    assert.ok(ids.includes('EPIC-002'));
    assert.ok(ids.includes('EPIC-003'));
  });

  it('keeps only the last event per epic (deduplication)', () => {
    const content = [
      '[EPIC-001] merge conflicts — attempting AI resolution — date1',
      '[EPIC-001] MERGED (AI-resolved) — date2',
    ].join('\n');
    const result = parseMergeEvents(content);
    assert.equal(result.length, 1);
    assert.equal(result[0].epicId, 'EPIC-001');
    assert.equal(result[0].status, 'merged-ai');
  });

  it('keeps only the last event when merge fails after conflict attempt', () => {
    const content = [
      '[EPIC-002] merge conflicts — attempting AI resolution — date1',
      '[EPIC-002] MERGE FAILED (AI resolution failed, files: b.ts) — date2',
    ].join('\n');
    const result = parseMergeEvents(content);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'merge-failed');
  });

  it('handles mixed content with non-merge lines interspersed', () => {
    const content = [
      '=== Wave 1 — date',
      '[EPIC-001] PASSED US-001 — date',
      '[EPIC-001] MERGED (clean) — date',
      '[EPIC-002] FAILED US-002 — date',
      '[EPIC-002] MERGED (AI-resolved) — date',
    ].join('\n');
    const result = parseMergeEvents(content);
    assert.equal(result.length, 2);
  });

  it('preserves detail field in merge-failed events', () => {
    const content = '[EPIC-001] MERGE FAILED (AI resolution failed, files: src/api.ts src/utils.ts) — date';
    const result = parseMergeEvents(content);
    assert.equal(result[0].detail, 'src/api.ts src/utils.ts');
  });
});

// ---------------------------------------------------------------------------
// mergeStatusLabel
// ---------------------------------------------------------------------------

describe('mergeStatusLabel', () => {
  it('returns correct label for merging', () => {
    assert.equal(mergeStatusLabel('merging'), 'resolving conflicts');
  });

  it('returns correct label for merged-clean', () => {
    assert.equal(mergeStatusLabel('merged-clean'), 'done (clean)');
  });

  it('returns correct label for merged-ai', () => {
    assert.equal(mergeStatusLabel('merged-ai'), 'done (AI-resolved)');
  });

  it('returns correct label for merge-failed', () => {
    assert.equal(mergeStatusLabel('merge-failed'), 'FAILED');
  });
});
