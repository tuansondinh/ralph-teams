import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  calculateCost,
  createEmptyRunStats,
  loadRunStats,
  saveRunStats,
  updateStoryStats,
  aggregateEpicStats,
  aggregateTotalStats,
  StoryStats,
  EpicStats,
  RunStats,
} from '../src/run-stats';
import { TokenUsage } from '../src/token-parser';
import { DEFAULT_CONFIG } from '../src/config';
import { validateConfig } from '../src/config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_PRICING = DEFAULT_CONFIG.pricing;

function makeStory(overrides: Partial<StoryStats> = {}): StoryStats {
  return {
    storyId: 'US-001',
    epicId: 'EPIC-001',
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationInputTokens: 200,
    cacheReadInputTokens: 50,
    costUsd: 0.05,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    durationFormatted: null,
    passed: true,
    ...overrides,
  };
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-run-stats-'));
}

// ---------------------------------------------------------------------------
// calculateCost
// ---------------------------------------------------------------------------

test('calculateCost returns correct USD for given token counts and pricing', () => {
  const usage: TokenUsage = {
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationInputTokens: 200,
    cacheReadInputTokens: 100,
  };

  // With default pricing:
  // input: (1000/1000) * 0.015 = 0.015
  // output: (500/1000) * 0.075 = 0.0375
  // cache creation: (200/1000) * 0.01875 = 0.00375
  // cache read: (100/1000) * 0.0015 = 0.00015
  // total = 0.0564
  const cost = calculateCost(usage, DEFAULT_PRICING);
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.0564) < 0.0001, `Expected ~0.0564, got ${cost}`);
});

test('calculateCost returns null when all tokens are null', () => {
  const usage: TokenUsage = {
    inputTokens: null,
    outputTokens: null,
    cacheCreationInputTokens: null,
    cacheReadInputTokens: null,
  };

  const cost = calculateCost(usage, DEFAULT_PRICING);
  assert.equal(cost, null);
});

test('calculateCost treats partial null fields as 0 (not null)', () => {
  const usage: TokenUsage = {
    inputTokens: 1000,
    outputTokens: null,
    cacheCreationInputTokens: null,
    cacheReadInputTokens: null,
  };

  const cost = calculateCost(usage, DEFAULT_PRICING);
  assert.ok(cost !== null);
  // Only input tokens counted: (1000/1000) * 0.015 = 0.015
  assert.ok(Math.abs(cost - 0.015) < 0.0001, `Expected 0.015, got ${cost}`);
});

test('calculateCost respects custom pricing rates', () => {
  const usage: TokenUsage = {
    inputTokens: 1000,
    outputTokens: 1000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };

  const customPricing = {
    inputTokenCostPer1k: 0.01,
    outputTokenCostPer1k: 0.02,
    cacheReadCostPer1k: 0,
    cacheCreationCostPer1k: 0,
  };

  const cost = calculateCost(usage, customPricing);
  assert.ok(cost !== null);
  assert.ok(Math.abs(cost - 0.03) < 0.0001, `Expected 0.03, got ${cost}`);
});

// ---------------------------------------------------------------------------
// loadRunStats
// ---------------------------------------------------------------------------

test('loadRunStats returns empty structure when file is missing', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  const result = loadRunStats(statsPath);

  assert.equal(result.version, 1);
  assert.deepEqual(result.epics, []);
  assert.equal(result.totals.storiesPassed, 0);
  assert.equal(result.totals.storiesTotal, 0);
  assert.equal(result.totals.costUsd, null);

  fs.rmSync(tmpDir, { recursive: true });
});

test('loadRunStats reads existing file correctly', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  const existing = createEmptyRunStats();
  existing.totals.storiesPassed = 3;
  existing.totals.storiesTotal = 5;
  fs.writeFileSync(statsPath, JSON.stringify(existing, null, 2), 'utf-8');

  const result = loadRunStats(statsPath);

  assert.equal(result.totals.storiesPassed, 3);
  assert.equal(result.totals.storiesTotal, 5);

  fs.rmSync(tmpDir, { recursive: true });
});

test('loadRunStats returns empty structure when file contains invalid JSON', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');
  fs.writeFileSync(statsPath, '{ broken json: ', 'utf-8');

  const result = loadRunStats(statsPath);
  assert.equal(result.version, 1);
  assert.deepEqual(result.epics, []);

  fs.rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// saveRunStats
// ---------------------------------------------------------------------------

test('saveRunStats writes pretty-printed JSON', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  const stats = createEmptyRunStats();
  saveRunStats(statsPath, stats);

  const content = fs.readFileSync(statsPath, 'utf-8');
  // Pretty-printed JSON has newlines and 2-space indentation
  assert.ok(content.includes('\n'), 'Expected newlines in pretty-printed JSON');
  assert.ok(content.includes('  '), 'Expected indentation in pretty-printed JSON');

  fs.rmSync(tmpDir, { recursive: true });
});

test('saveRunStats produces valid JSON that loadRunStats can read back', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  const stats = createEmptyRunStats();
  stats.totals.storiesPassed = 7;
  stats.totals.costUsd = 1.23;

  saveRunStats(statsPath, stats);
  const loaded = loadRunStats(statsPath);

  assert.equal(loaded.totals.storiesPassed, 7);
  assert.equal(loaded.totals.costUsd, 1.23);

  fs.rmSync(tmpDir, { recursive: true });
});

test('saveRunStats ends file with a trailing newline', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  saveRunStats(statsPath, createEmptyRunStats());
  const content = fs.readFileSync(statsPath, 'utf-8');
  assert.ok(content.endsWith('\n'), 'Expected trailing newline');

  fs.rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// updateStoryStats
// ---------------------------------------------------------------------------

test('updateStoryStats adds a new story and recalculates aggregates', () => {
  const stats = createEmptyRunStats();
  const story = makeStory({ storyId: 'US-001', epicId: 'EPIC-001', passed: true, costUsd: 0.05 });

  const updated = updateStoryStats(stats, story);

  assert.equal(updated.epics.length, 1);
  assert.equal(updated.epics[0].epicId, 'EPIC-001');
  assert.equal(updated.epics[0].stories.length, 1);
  assert.equal(updated.epics[0].storiesPassed, 1);
  assert.equal(updated.epics[0].storiesTotal, 1);
  assert.ok(Math.abs((updated.epics[0].totalCostUsd ?? 0) - 0.05) < 0.0001);
  assert.equal(updated.totals.storiesPassed, 1);
  assert.equal(updated.totals.storiesTotal, 1);
  assert.ok(Math.abs((updated.totals.costUsd ?? 0) - 0.05) < 0.0001);
});

test('updateStoryStats updates existing story (idempotent upsert)', () => {
  let stats = createEmptyRunStats();
  const story1 = makeStory({ storyId: 'US-001', epicId: 'EPIC-001', passed: false, costUsd: 0.03 });
  stats = updateStoryStats(stats, story1);

  // Update the same story — passed=true, higher cost
  const story1Updated = makeStory({ storyId: 'US-001', epicId: 'EPIC-001', passed: true, costUsd: 0.07 });
  stats = updateStoryStats(stats, story1Updated);

  assert.equal(stats.epics[0].stories.length, 1, 'Should still have only 1 story (upsert)');
  assert.equal(stats.epics[0].storiesPassed, 1);
  assert.ok(Math.abs((stats.epics[0].totalCostUsd ?? 0) - 0.07) < 0.0001);
});

test('updateStoryStats adds stories to multiple epics and sums totals correctly', () => {
  let stats = createEmptyRunStats();

  stats = updateStoryStats(stats, makeStory({ storyId: 'US-001', epicId: 'EPIC-001', passed: true, costUsd: 0.10 }));
  stats = updateStoryStats(stats, makeStory({ storyId: 'US-002', epicId: 'EPIC-001', passed: false, costUsd: 0.05 }));
  stats = updateStoryStats(stats, makeStory({ storyId: 'US-003', epicId: 'EPIC-002', passed: true, costUsd: 0.20 }));

  assert.equal(stats.epics.length, 2);
  assert.equal(stats.totals.storiesTotal, 3);
  assert.equal(stats.totals.storiesPassed, 2);
  assert.ok(Math.abs((stats.totals.costUsd ?? 0) - 0.35) < 0.0001);
});

// ---------------------------------------------------------------------------
// aggregateEpicStats
// ---------------------------------------------------------------------------

test('aggregateEpicStats sums tokens correctly across stories', () => {
  const stories: StoryStats[] = [
    makeStory({ storyId: 'US-001', inputTokens: 1000, outputTokens: 500, costUsd: 0.05, passed: true }),
    makeStory({ storyId: 'US-002', inputTokens: 2000, outputTokens: 300, costUsd: 0.03, passed: false }),
  ];

  const epicStats = aggregateEpicStats('EPIC-001', stories);

  assert.equal(epicStats.totalInputTokens, 3000);
  assert.equal(epicStats.totalOutputTokens, 800);
  assert.ok(Math.abs((epicStats.totalCostUsd ?? 0) - 0.08) < 0.0001);
  assert.equal(epicStats.storiesPassed, 1);
  assert.equal(epicStats.storiesTotal, 2);
});

test('aggregateEpicStats returns null token totals when all story tokens are null', () => {
  const stories: StoryStats[] = [
    makeStory({ storyId: 'US-001', inputTokens: null, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null, costUsd: null }),
    makeStory({ storyId: 'US-002', inputTokens: null, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null, costUsd: null }),
  ];

  const epicStats = aggregateEpicStats('EPIC-001', stories);

  assert.equal(epicStats.totalInputTokens, null);
  assert.equal(epicStats.totalOutputTokens, null);
  assert.equal(epicStats.totalCostUsd, null);
});

test('aggregateEpicStats mixes null and non-null token values (treats null as 0)', () => {
  const stories: StoryStats[] = [
    makeStory({ storyId: 'US-001', inputTokens: 500, outputTokens: null, costUsd: 0.01 }),
    makeStory({ storyId: 'US-002', inputTokens: null, outputTokens: 200, costUsd: 0.02 }),
  ];

  const epicStats = aggregateEpicStats('EPIC-001', stories);

  // sumNullable: since at least one is non-null, null treated as 0
  assert.equal(epicStats.totalInputTokens, 500);
  assert.equal(epicStats.totalOutputTokens, 200);
  assert.ok(Math.abs((epicStats.totalCostUsd ?? 0) - 0.03) < 0.0001);
});

// ---------------------------------------------------------------------------
// aggregateTotalStats
// ---------------------------------------------------------------------------

test('aggregateTotalStats sums across multiple epics', () => {
  const epic1 = aggregateEpicStats('EPIC-001', [
    makeStory({ storyId: 'US-001', costUsd: 0.10, passed: true }),
    makeStory({ storyId: 'US-002', costUsd: 0.05, passed: false }),
  ]);
  const epic2 = aggregateEpicStats('EPIC-002', [
    makeStory({ storyId: 'US-003', costUsd: 0.20, passed: true }),
  ]);

  const totals = aggregateTotalStats([epic1, epic2]);

  assert.equal(totals.storiesTotal, 3);
  assert.equal(totals.storiesPassed, 2);
  assert.ok(Math.abs((totals.costUsd ?? 0) - 0.35) < 0.0001);
});

// ---------------------------------------------------------------------------
// Config pricing validation
// ---------------------------------------------------------------------------

test('validateConfig accepts valid pricing values', () => {
  const { errors, config } = validateConfig({
    pricing: {
      inputTokenCostPer1k: 0.01,
      outputTokenCostPer1k: 0.05,
      cacheReadCostPer1k: 0.001,
      cacheCreationCostPer1k: 0.0125,
    },
  });

  assert.equal(errors.length, 0);
  assert.equal(config.pricing.inputTokenCostPer1k, 0.01);
  assert.equal(config.pricing.outputTokenCostPer1k, 0.05);
});

test('validateConfig accepts 0 pricing values (free model)', () => {
  const { errors } = validateConfig({
    pricing: {
      inputTokenCostPer1k: 0,
      outputTokenCostPer1k: 0,
      cacheReadCostPer1k: 0,
      cacheCreationCostPer1k: 0,
    },
  });

  assert.equal(errors.length, 0);
});

test('validateConfig rejects negative pricing values', () => {
  const { errors } = validateConfig({
    pricing: {
      inputTokenCostPer1k: -0.01,
      outputTokenCostPer1k: -0.05,
      cacheReadCostPer1k: 0.001,
      cacheCreationCostPer1k: 0.0125,
    },
  });

  assert.ok(errors.length >= 2, 'Expected at least 2 errors for negative pricing fields');
  const joined = errors.join('\n');
  assert.match(joined, /pricing\.inputTokenCostPer1k/);
  assert.match(joined, /pricing\.outputTokenCostPer1k/);
});

test('validateConfig rejects non-number pricing values', () => {
  const { errors } = validateConfig({
    pricing: {
      inputTokenCostPer1k: 'free',
      outputTokenCostPer1k: null,
    },
  });

  assert.ok(errors.length >= 1);
  const joined = errors.join('\n');
  assert.match(joined, /pricing\.inputTokenCostPer1k/);
});

test('validateConfig fills in pricing defaults for omitted fields', () => {
  const { errors, config } = validateConfig({
    pricing: {
      inputTokenCostPer1k: 0.02,
    },
  });

  assert.equal(errors.length, 0);
  assert.equal(config.pricing.inputTokenCostPer1k, 0.02);
  // Other fields retain defaults
  assert.equal(config.pricing.outputTokenCostPer1k, DEFAULT_CONFIG.pricing.outputTokenCostPer1k);
  assert.equal(config.pricing.cacheReadCostPer1k, DEFAULT_CONFIG.pricing.cacheReadCostPer1k);
  assert.equal(config.pricing.cacheCreationCostPer1k, DEFAULT_CONFIG.pricing.cacheCreationCostPer1k);
});

test('validateConfig rejects pricing section that is not an object', () => {
  const { errors } = validateConfig({
    pricing: 'free',
  });

  assert.ok(errors.length > 0);
  const joined = errors.join('\n');
  assert.match(joined, /pricing/);
});
