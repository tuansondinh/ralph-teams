import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../src/time-utils';

test('formatDuration returns "<1s" for zero ms', () => {
  assert.equal(formatDuration(0), '<1s');
});

test('formatDuration returns "<1s" for sub-second durations', () => {
  assert.equal(formatDuration(500), '<1s');
  assert.equal(formatDuration(999), '<1s');
});

test('formatDuration returns seconds-only for 1000ms to 59999ms', () => {
  assert.equal(formatDuration(1000), '1s');
  assert.equal(formatDuration(45000), '45s');
  assert.equal(formatDuration(59000), '59s');
  assert.equal(formatDuration(59999), '59s');
});

test('formatDuration returns "Xm Ys" for minutes and seconds', () => {
  assert.equal(formatDuration(272000), '4m 32s');   // 4*60+32 = 272s
  assert.equal(formatDuration(90000), '1m 30s');
  assert.equal(formatDuration(3599000), '59m 59s');
});

test('formatDuration returns "1m 0s" at exact minute boundary (60000ms)', () => {
  assert.equal(formatDuration(60000), '1m 0s');
});

test('formatDuration returns "Xh Ym Zs" for hours, minutes, seconds', () => {
  // 5025000ms = 5025s = 1h 23m 45s
  assert.equal(formatDuration(5025000), '1h 23m 45s');
  // 3600000ms = 1h exactly
  assert.equal(formatDuration(3600000), '1h 0m 0s');
  // 7261000ms = 2h 1m 1s
  assert.equal(formatDuration(7261000), '2h 1m 1s');
});

test('formatDuration handles large hour values', () => {
  // 36000000ms = 10h 0m 0s
  assert.equal(formatDuration(36000000), '10h 0m 0s');
});
