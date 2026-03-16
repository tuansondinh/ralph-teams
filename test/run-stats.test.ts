import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  calculateCost,
  calculateEstimates,
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
import { DEFAULT_CONFIG, validateConfig } from '../src/config';
import { formatDuration } from '../src/time-utils';

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

// ---------------------------------------------------------------------------
// Time tracking — story level
// ---------------------------------------------------------------------------

test('aggregateEpicStats derives time from story startedAt and completedAt', () => {
  const stories: StoryStats[] = [
    makeStory({
      storyId: 'US-001',
      startedAt: '2024-01-01T10:00:00.000Z',
      completedAt: '2024-01-01T10:05:00.000Z',  // +5 min
    }),
  ];

  const epic = aggregateEpicStats('EPIC-001', stories);

  assert.equal(epic.startedAt, '2024-01-01T10:00:00.000Z');
  assert.equal(epic.completedAt, '2024-01-01T10:05:00.000Z');
  assert.equal(epic.durationMs, 300_000);
  assert.equal(epic.durationFormatted, '5m 0s');
});

test('aggregateEpicStats uses min(startedAt) and max(completedAt) across stories', () => {
  const stories: StoryStats[] = [
    makeStory({
      storyId: 'US-001',
      startedAt: '2024-01-01T10:00:00.000Z',
      completedAt: '2024-01-01T10:04:00.000Z',
    }),
    makeStory({
      storyId: 'US-002',
      startedAt: '2024-01-01T10:02:00.000Z',   // later start
      completedAt: '2024-01-01T10:08:00.000Z',  // later end
    }),
  ];

  const epic = aggregateEpicStats('EPIC-001', stories);

  assert.equal(epic.startedAt, '2024-01-01T10:00:00.000Z');  // min
  assert.equal(epic.completedAt, '2024-01-01T10:08:00.000Z');  // max
  assert.equal(epic.durationMs, 480_000);  // 8 minutes
  assert.equal(epic.durationFormatted, '8m 0s');
});

test('aggregateEpicStats leaves time null when stories have no timestamps', () => {
  const stories: StoryStats[] = [
    makeStory({ storyId: 'US-001', startedAt: null, completedAt: null }),
    makeStory({ storyId: 'US-002', startedAt: null, completedAt: null }),
  ];

  const epic = aggregateEpicStats('EPIC-001', stories);

  assert.equal(epic.startedAt, null);
  assert.equal(epic.completedAt, null);
  assert.equal(epic.durationMs, null);
  assert.equal(epic.durationFormatted, null);
});

// ---------------------------------------------------------------------------
// Time tracking — total level
// ---------------------------------------------------------------------------

test('aggregateTotalStats derives time from epic startedAt and completedAt', () => {
  const epic1 = aggregateEpicStats('EPIC-001', [
    makeStory({
      storyId: 'US-001',
      startedAt: '2024-01-01T09:00:00.000Z',
      completedAt: '2024-01-01T09:30:00.000Z',
    }),
  ]);
  const epic2 = aggregateEpicStats('EPIC-002', [
    makeStory({
      storyId: 'US-002',
      startedAt: '2024-01-01T09:10:00.000Z',
      completedAt: '2024-01-01T09:50:00.000Z',
    }),
  ]);

  const totals = aggregateTotalStats([epic1, epic2]);

  assert.equal(totals.startedAt, '2024-01-01T09:00:00.000Z');  // min of epic starts
  // completedAt = max of epic ends; epic2 ends at 09:50
  assert.equal(totals.durationMs, 50 * 60 * 1000);  // 50 minutes
  assert.equal(totals.durationFormatted, '50m 0s');
});

test('aggregateTotalStats leaves time null when no epics have timestamps', () => {
  const epic1 = aggregateEpicStats('EPIC-001', [
    makeStory({ storyId: 'US-001', startedAt: null, completedAt: null }),
  ]);

  const totals = aggregateTotalStats([epic1]);

  assert.equal(totals.startedAt, null);
  assert.equal(totals.durationMs, null);
  assert.equal(totals.durationFormatted, null);
});

// ---------------------------------------------------------------------------
// Time tracking — end-to-end via updateStoryStats
// ---------------------------------------------------------------------------

test('updateStoryStats propagates time from story through epic to totals', () => {
  const stats = createEmptyRunStats();

  const story = makeStory({
    storyId: 'US-001',
    epicId: 'EPIC-001',
    startedAt: '2024-06-01T12:00:00.000Z',
    completedAt: '2024-06-01T12:10:30.000Z',  // +10m 30s = 630s = 630000ms
  });

  const updated = updateStoryStats(stats, story);

  assert.equal(updated.epics[0].startedAt, '2024-06-01T12:00:00.000Z');
  assert.equal(updated.epics[0].completedAt, '2024-06-01T12:10:30.000Z');
  assert.equal(updated.epics[0].durationMs, 630_000);
  assert.equal(updated.epics[0].durationFormatted, '10m 30s');

  assert.equal(updated.totals.startedAt, '2024-06-01T12:00:00.000Z');
  assert.equal(updated.totals.durationMs, 630_000);
  assert.equal(updated.totals.durationFormatted, '10m 30s');
});

// ---------------------------------------------------------------------------
// calculateEstimates
// ---------------------------------------------------------------------------

test('calculateEstimates returns -- for cost and time when no stories completed', () => {
  const stats = createEmptyRunStats();
  const estimates = calculateEstimates(stats, 10);

  assert.equal(estimates.estimatedTotalCostUsd, '--');
  assert.equal(estimates.estimatedTotalTimeMs, null);
  assert.equal(estimates.estimatedTotalTimeFormatted, '--');
  assert.equal(estimates.averageCostPerStory, null);
  assert.equal(estimates.averageTimePerStoryMs, null);
  assert.equal(estimates.storiesRemaining, 10);
});

test('calculateEstimates calculates correct estimate with 2 of 10 stories done', () => {
  let stats = createEmptyRunStats();
  // 2 stories with $0.10 each = $0.20 total, avg $0.10, 8 remaining → est $0.20 + $0.80 = $1.00
  stats = updateStoryStats(stats, makeStory({ storyId: 'US-001', epicId: 'EPIC-001', costUsd: 0.10, passed: true }));
  stats = updateStoryStats(stats, makeStory({ storyId: 'US-002', epicId: 'EPIC-001', costUsd: 0.10, passed: true }));

  const estimates = calculateEstimates(stats, 10);

  assert.equal(estimates.estimatedTotalCostUsd, '$1.00');
  assert.equal(estimates.averageCostPerStory, 0.10);
  assert.equal(estimates.storiesRemaining, 8);
});

test('calculateEstimates estimate updates as more stories complete', () => {
  let stats = createEmptyRunStats();
  // After 1 of 4 stories: avg=$0.20, remaining=3, est = $0.20 + $0.60 = $0.80
  stats = updateStoryStats(stats, makeStory({ storyId: 'US-001', epicId: 'EPIC-001', costUsd: 0.20, passed: true }), 4);
  assert.equal(stats.estimates.estimatedTotalCostUsd, '$0.80');
  assert.equal(stats.estimates.storiesRemaining, 3);

  // After 2 of 4 stories: avg=$0.25 (0.20+0.30)/2, remaining=2, est = $0.50 + $0.50 = $1.00
  stats = updateStoryStats(stats, makeStory({ storyId: 'US-002', epicId: 'EPIC-001', costUsd: 0.30, passed: true }), 4);
  assert.equal(stats.estimates.estimatedTotalCostUsd, '$1.00');
  assert.equal(stats.estimates.storiesRemaining, 2);
});

test('calculateEstimates excludes stories with null cost from average', () => {
  let stats = createEmptyRunStats();
  // Story with null cost is not counted
  stats = updateStoryStats(stats, makeStory({ storyId: 'US-001', epicId: 'EPIC-001', costUsd: null, passed: true }));
  // Still shows '--' because no priced stories yet
  assert.equal(stats.estimates.estimatedTotalCostUsd, '--');

  // Now add a priced story — only this one counts: avg=$0.20, remaining=(2-1)=1, est=$0.40
  stats = updateStoryStats(stats, makeStory({ storyId: 'US-002', epicId: 'EPIC-001', costUsd: 0.20, passed: true }), 2);
  assert.equal(stats.estimates.estimatedTotalCostUsd, '$0.40');
  assert.equal(stats.estimates.averageCostPerStory, 0.20);
});

test('calculateEstimates time estimate works independently of cost', () => {
  let stats = createEmptyRunStats();
  // Story with cost data AND time data
  stats = updateStoryStats(stats, makeStory({
    storyId: 'US-001',
    epicId: 'EPIC-001',
    costUsd: 0.10,
    durationMs: 60_000,   // 1 minute
    passed: true,
  }), 4);

  const est = stats.estimates;
  // avg time = 60000ms, remaining = 3, estimated = 60000 + 3*60000 = 240000ms = 4m 0s
  assert.equal(est.averageTimePerStoryMs, 60_000);
  assert.equal(est.estimatedTotalTimeMs, 240_000);
  assert.equal(est.estimatedTotalTimeFormatted, '4m 0s');
});

test('calculateEstimates time estimate is -- when no stories have duration data', () => {
  let stats = createEmptyRunStats();
  // Story with cost but no time
  stats = updateStoryStats(stats, makeStory({
    storyId: 'US-001',
    epicId: 'EPIC-001',
    costUsd: 0.10,
    durationMs: null,
    passed: true,
  }), 4);

  assert.equal(stats.estimates.estimatedTotalTimeFormatted, '--');
  assert.equal(stats.estimates.averageTimePerStoryMs, null);
  assert.equal(stats.estimates.estimatedTotalTimeMs, null);
  // Cost estimate still works
  assert.equal(stats.estimates.estimatedTotalCostUsd, '$0.40');
});

test('calculateEstimates storiesRemaining is 0 when all stories complete', () => {
  let stats = createEmptyRunStats();
  stats = updateStoryStats(stats, makeStory({ storyId: 'US-001', epicId: 'EPIC-001', costUsd: 0.10, passed: true }), 1);

  assert.equal(stats.estimates.storiesRemaining, 0);
  // With 0 remaining, estimate equals actual cost
  assert.equal(stats.estimates.estimatedTotalCostUsd, '$0.10');
});

test('calculateEstimates is refreshed on every updateStoryStats call', () => {
  // updateStoryStats auto-calls calculateEstimates; estimates should reflect latest state
  let stats = createEmptyRunStats();
  stats = updateStoryStats(stats, makeStory({ storyId: 'US-001', epicId: 'EPIC-001', costUsd: 0.05, passed: true }), 5);
  const firstEstimate = stats.estimates.estimatedTotalCostUsd;

  stats = updateStoryStats(stats, makeStory({ storyId: 'US-002', epicId: 'EPIC-001', costUsd: 0.15, passed: true }), 5);
  const secondEstimate = stats.estimates.estimatedTotalCostUsd;

  // Estimates should differ as more data comes in
  assert.notEqual(firstEstimate, secondEstimate);
});

// ---------------------------------------------------------------------------
// US-010: schema round-trip, atomic write, file absence
// ---------------------------------------------------------------------------

test('saveRunStats writes 2-space indented JSON', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  saveRunStats(statsPath, createEmptyRunStats());

  const content = fs.readFileSync(statsPath, 'utf-8');
  // 2-space indent produces lines like '  "version": 1'
  assert.ok(content.includes('  "version": 1'), 'Expected 2-space indented "version" key');
  assert.ok(content.includes('  "epics": []'), 'Expected 2-space indented "epics" array');

  fs.rmSync(tmpDir, { recursive: true });
});

test('saveRunStats round-trip: saved file is loadable and fields match', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  let stats = createEmptyRunStats();
  stats = updateStoryStats(stats, makeStory({
    storyId: 'US-001',
    epicId: 'EPIC-001',
    costUsd: 1.23,
    passed: true,
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:05:00.000Z',
    durationMs: 300_000,
    durationFormatted: '5m 0s',
  }), 3);

  saveRunStats(statsPath, stats);
  const loaded = loadRunStats(statsPath);

  assert.equal(loaded.version, 1);
  assert.equal(loaded.epics.length, 1);
  assert.equal(loaded.epics[0].epicId, 'EPIC-001');
  assert.equal(loaded.epics[0].stories[0].storyId, 'US-001');
  assert.ok(Math.abs((loaded.epics[0].totalCostUsd ?? 0) - 1.23) < 0.0001);
  assert.equal(loaded.totals.storiesPassed, 1);
  assert.equal(loaded.totals.storiesTotal, 1);
  assert.ok(loaded.estimates.storiesRemaining === 2);

  fs.rmSync(tmpDir, { recursive: true });
});

test('saveRunStats atomic write: no temp file left behind after success', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  saveRunStats(statsPath, createEmptyRunStats());

  // Temp file should be gone (renamed to final path)
  const files = fs.readdirSync(tmpDir);
  const tmpFiles = files.filter(f => f.includes('.tmp'));
  assert.equal(tmpFiles.length, 0, `Expected no temp files, found: ${tmpFiles.join(', ')}`);

  fs.rmSync(tmpDir, { recursive: true });
});

test('full schema round-trip: all fields populated, save and reload preserves every field', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'ralph-run-stats.json');

  // Build a stats object with all fields populated via updateStoryStats
  let stats = createEmptyRunStats();
  stats = updateStoryStats(stats, makeStory({
    storyId: 'US-001',
    epicId: 'EPIC-001',
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationInputTokens: 200,
    cacheReadInputTokens: 50,
    costUsd: 0.05,
    startedAt: '2024-06-01T10:00:00.000Z',
    completedAt: '2024-06-01T10:05:00.000Z',
    durationMs: 300_000,
    durationFormatted: '5m 0s',
    passed: true,
  }), 2);
  stats = updateStoryStats(stats, makeStory({
    storyId: 'US-002',
    epicId: 'EPIC-001',
    inputTokens: 2000,
    outputTokens: 800,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 100,
    costUsd: 0.10,
    startedAt: '2024-06-01T10:06:00.000Z',
    completedAt: '2024-06-01T10:09:00.000Z',
    durationMs: 180_000,
    durationFormatted: '3m 0s',
    passed: false,
  }), 2);

  saveRunStats(statsPath, stats);
  const loaded = loadRunStats(statsPath);

  // version
  assert.equal(loaded.version, 1);
  // epics
  assert.equal(loaded.epics.length, 1);
  const epic = loaded.epics[0];
  assert.equal(epic.epicId, 'EPIC-001');
  assert.equal(epic.stories.length, 2);
  assert.equal(epic.storiesPassed, 1);
  assert.equal(epic.storiesTotal, 2);
  assert.equal(epic.totalInputTokens, 3000);
  assert.equal(epic.totalOutputTokens, 1300);
  assert.ok(Math.abs((epic.totalCostUsd ?? 0) - 0.15) < 0.0001);
  assert.equal(epic.startedAt, '2024-06-01T10:00:00.000Z');
  assert.equal(epic.completedAt, '2024-06-01T10:09:00.000Z');
  assert.equal(epic.durationMs, 540_000);   // 9 minutes end-to-end
  assert.equal(epic.durationFormatted, '9m 0s');
  // totals
  assert.equal(loaded.totals.storiesPassed, 1);
  assert.equal(loaded.totals.storiesTotal, 2);
  assert.ok(Math.abs((loaded.totals.costUsd ?? 0) - 0.15) < 0.0001);
  assert.equal(loaded.totals.startedAt, '2024-06-01T10:00:00.000Z');
  // estimates (2 stories, totalStoriesInRun=2, so 0 remaining)
  assert.equal(loaded.estimates.storiesRemaining, 0);
  assert.ok(loaded.estimates.estimatedTotalCostUsd !== null);

  fs.rmSync(tmpDir, { recursive: true });
});

test('loadRunStats returns empty default structure when file does not exist', () => {
  const tmpDir = makeTempDir();
  const statsPath = path.join(tmpDir, 'nonexistent.json');

  const stats = loadRunStats(statsPath);

  assert.equal(stats.version, 1);
  assert.deepEqual(stats.epics, []);
  assert.equal(stats.totals.storiesPassed, 0);
  assert.equal(stats.totals.storiesTotal, 0);
  assert.equal(stats.totals.costUsd, null);
  assert.equal(stats.totals.durationMs, null);
  assert.equal(stats.estimates.storiesRemaining, 0);
  assert.equal(stats.estimates.estimatedTotalCostUsd, null);

  fs.rmSync(tmpDir, { recursive: true });
});
