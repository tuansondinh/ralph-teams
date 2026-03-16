/**
 * test/guidance-writer.test.ts — Unit tests for guidance-writer.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { guidancePath, guidanceExists, saveGuidance } from '../src/dashboard/guidance-writer';
import type { DiscussContext, DiscussMessage } from '../src/dashboard/views/discuss-view';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-guidance-test-'));
}

function makeContext(overrides: Partial<DiscussContext> = {}): DiscussContext {
  return {
    storyId: 'US-003',
    storyTitle: 'Authentication flow',
    epicId: 'EPIC-001',
    epicTitle: 'Foundation',
    failureReason: 'Token refresh not implemented',
    validatorReport: ['Result: FAIL', '- Token refresh returns 401'],
    codeDiff: 'src/auth.ts | 5 +++++',
    planSection: '## US-003\nImplement token refresh...',
    ...overrides,
  };
}

function makeMessages(texts: string[]): DiscussMessage[] {
  return texts.map(text => ({ role: 'user' as const, text }));
}

// ---------------------------------------------------------------------------
// guidancePath
// ---------------------------------------------------------------------------

describe('guidancePath', () => {
  it('returns <guidanceDir>/guidance-<storyId>.md', () => {
    const result = guidancePath('/some/dir', 'US-003');
    assert.equal(result, '/some/dir/guidance-US-003.md');
  });

  it('handles story IDs with hyphens and uppercase', () => {
    const result = guidancePath('/guidance', 'US-042');
    assert.equal(result, '/guidance/guidance-US-042.md');
  });

  it('works with relative guidance directory', () => {
    const result = guidancePath('guidance', 'US-001');
    assert.equal(result, path.join('guidance', 'guidance-US-001.md'));
  });
});

// ---------------------------------------------------------------------------
// guidanceExists
// ---------------------------------------------------------------------------

describe('guidanceExists', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false when guidance file does not exist', () => {
    assert.equal(guidanceExists(tmpDir, 'US-999'), false);
  });

  it('returns true when guidance file exists', () => {
    const filePath = guidancePath(tmpDir, 'US-001');
    fs.writeFileSync(filePath, 'test content', 'utf-8');
    assert.equal(guidanceExists(tmpDir, 'US-001'), true);
  });

  it('returns false for a different story ID in the same dir', () => {
    // US-001 file was created in the previous test
    assert.equal(guidanceExists(tmpDir, 'US-002'), false);
  });

  it('returns false when guidanceDir does not exist', () => {
    assert.equal(guidanceExists('/nonexistent/dir', 'US-001'), false);
  });
});

// ---------------------------------------------------------------------------
// saveGuidance
// ---------------------------------------------------------------------------

describe('saveGuidance', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the guidance directory if it does not exist', () => {
    const nestedDir = path.join(tmpDir, 'nested', 'guidance');
    assert.equal(fs.existsSync(nestedDir), false);
    saveGuidance(nestedDir, 'US-003', makeContext(), []);
    assert.equal(fs.existsSync(nestedDir), true);
  });

  it('writes a file at the correct path', () => {
    const ctx = makeContext();
    saveGuidance(tmpDir, 'US-003', ctx, makeMessages(['Please fix the token refresh']));
    const expectedPath = guidancePath(tmpDir, 'US-003');
    assert.equal(fs.existsSync(expectedPath), true);
  });

  it('file content includes story ID and title in heading', () => {
    const ctx = makeContext({ storyId: 'US-007', storyTitle: 'User login' });
    saveGuidance(tmpDir, 'US-007', ctx, makeMessages(['Fix it']));
    const content = fs.readFileSync(guidancePath(tmpDir, 'US-007'), 'utf-8');
    assert.ok(content.includes('# Guidance for US-007: User login'), `Expected heading in:\n${content}`);
  });

  it('file content includes epic ID and title', () => {
    const ctx = makeContext({ epicId: 'EPIC-002', epicTitle: 'Billing' });
    saveGuidance(tmpDir, 'US-010', ctx, []);
    const content = fs.readFileSync(guidancePath(tmpDir, 'US-010'), 'utf-8');
    assert.ok(content.includes('EPIC-002 — Billing'), `Epic info missing in:\n${content}`);
  });

  it('file content includes failure reason', () => {
    const ctx = makeContext({ failureReason: 'JWT secret not configured' });
    saveGuidance(tmpDir, 'US-011', ctx, []);
    const content = fs.readFileSync(guidancePath(tmpDir, 'US-011'), 'utf-8');
    assert.ok(content.includes('JWT secret not configured'), `Failure reason missing in:\n${content}`);
  });

  it('file content includes user guidance messages', () => {
    const messages = makeMessages([
      'Use RS256 algorithm for JWT',
      'Check the secret in env vars',
    ]);
    saveGuidance(tmpDir, 'US-012', makeContext(), messages);
    const content = fs.readFileSync(guidancePath(tmpDir, 'US-012'), 'utf-8');
    assert.ok(content.includes('Use RS256 algorithm for JWT'), `First message missing in:\n${content}`);
    assert.ok(content.includes('Check the secret in env vars'), `Second message missing in:\n${content}`);
  });

  it('excludes context-role messages from file', () => {
    const messages: DiscussMessage[] = [
      { role: 'context', text: 'Auto-generated context: some details' },
      { role: 'user', text: 'Please do X' },
    ];
    saveGuidance(tmpDir, 'US-013', makeContext(), messages);
    const content = fs.readFileSync(guidancePath(tmpDir, 'US-013'), 'utf-8');
    assert.ok(!content.includes('Auto-generated context'), `Context message should not appear in:\n${content}`);
    assert.ok(content.includes('Please do X'), `User message missing in:\n${content}`);
  });

  it('writes placeholder when no user messages exist', () => {
    saveGuidance(tmpDir, 'US-014', makeContext(), []);
    const content = fs.readFileSync(guidancePath(tmpDir, 'US-014'), 'utf-8');
    assert.ok(content.includes('no explicit guidance provided'), `Placeholder missing in:\n${content}`);
  });

  it('writes placeholder when only context messages exist', () => {
    const messages: DiscussMessage[] = [
      { role: 'context', text: 'Context only' },
    ];
    saveGuidance(tmpDir, 'US-015', makeContext(), messages);
    const content = fs.readFileSync(guidancePath(tmpDir, 'US-015'), 'utf-8');
    assert.ok(content.includes('no explicit guidance provided'), `Placeholder missing in:\n${content}`);
  });

  it('overwrites existing guidance file on re-save', () => {
    const ctx = makeContext({ storyId: 'US-016', storyTitle: 'Overwrite test' });
    saveGuidance(tmpDir, 'US-016', ctx, makeMessages(['First guidance']));
    saveGuidance(tmpDir, 'US-016', ctx, makeMessages(['Second guidance']));
    const content = fs.readFileSync(guidancePath(tmpDir, 'US-016'), 'utf-8');
    assert.ok(content.includes('Second guidance'), `Updated guidance missing in:\n${content}`);
    assert.ok(!content.includes('First guidance'), `Old guidance should not appear in:\n${content}`);
  });

  it('handles null failureReason gracefully', () => {
    const ctx = makeContext({ failureReason: null });
    saveGuidance(tmpDir, 'US-017', ctx, []);
    const content = fs.readFileSync(guidancePath(tmpDir, 'US-017'), 'utf-8');
    assert.ok(content.includes('not recorded'), `Null failure reason not handled in:\n${content}`);
  });

  it('guidanceExists returns true after saveGuidance', () => {
    saveGuidance(tmpDir, 'US-020', makeContext(), makeMessages(['test']));
    assert.equal(guidanceExists(tmpDir, 'US-020'), true);
  });
});
