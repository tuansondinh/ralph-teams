/**
 * test/guidance.test.ts — Unit tests for src/guidance.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getGuidancePath,
  saveGuidance,
  loadGuidance,
  formatGuidanceContent,
} from '../src/guidance';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-guidance-test-'));
}

const sampleContext = {
  failureContext: 'Token refresh not implemented — returns 401.',
  userInstructions: 'Use the refreshToken endpoint and store the new token in localStorage.',
  approach: 'Call /api/refresh on 401, retry the original request once.',
};

// ---------------------------------------------------------------------------
// getGuidancePath
// ---------------------------------------------------------------------------

describe('getGuidancePath', () => {
  it('returns <guidanceDir>/guidance-<storyId>.md with default dir', () => {
    const result = getGuidancePath('US-003');
    assert.equal(result, path.join('.ralph-teams', 'guidance', 'guidance-US-003.md'));
  });

  it('returns <guidanceDir>/guidance-<storyId>.md with custom dir', () => {
    const result = getGuidancePath('US-003', '/custom/dir');
    assert.equal(result, '/custom/dir/guidance-US-003.md');
  });

  it('handles story IDs with hyphens and uppercase', () => {
    const result = getGuidancePath('US-042', '/guidance');
    assert.equal(result, '/guidance/guidance-US-042.md');
  });

  it('prefixes the filename with guidance-', () => {
    const result = getGuidancePath('US-019', 'guidance');
    assert.match(result, /guidance-US-019\.md$/);
  });
});

// ---------------------------------------------------------------------------
// formatGuidanceContent
// ---------------------------------------------------------------------------

describe('formatGuidanceContent', () => {
  it('produces expected markdown sections', () => {
    const content = formatGuidanceContent(sampleContext);
    assert.match(content, /^# Story Guidance/);
    assert.match(content, /## Failure Context/);
    assert.match(content, /## User Instructions/);
    assert.match(content, /## Agreed Approach/);
  });

  it('includes failure context in output', () => {
    const content = formatGuidanceContent(sampleContext);
    assert.match(content, /Token refresh not implemented/);
  });

  it('includes user instructions in output', () => {
    const content = formatGuidanceContent(sampleContext);
    assert.match(content, /refreshToken endpoint/);
  });

  it('includes approach in output', () => {
    const content = formatGuidanceContent(sampleContext);
    assert.match(content, /api\/refresh/);
  });

  it('uses placeholders for empty fields', () => {
    const content = formatGuidanceContent({ failureContext: '', userInstructions: '', approach: '' });
    assert.match(content, /\(no failure context recorded\)/);
    assert.match(content, /\(no explicit instructions provided\)/);
    assert.match(content, /\(no specific approach agreed upon\)/);
  });

  it('trims whitespace from fields before rendering', () => {
    const content = formatGuidanceContent({
      failureContext: '  leading space  ',
      userInstructions: '\nsome instructions\n',
      approach: '\t approach here \t',
    });
    assert.match(content, /leading space/);
    assert.match(content, /some instructions/);
    assert.match(content, /approach here/);
  });
});

// ---------------------------------------------------------------------------
// saveGuidance
// ---------------------------------------------------------------------------

describe('saveGuidance', () => {
  it('creates the guidance directory if it does not exist', () => {
    const tmpDir = makeTmpDir();
    const guidanceDir = path.join(tmpDir, 'guidance');

    assert.equal(fs.existsSync(guidanceDir), false);
    saveGuidance('US-003', sampleContext, guidanceDir);
    assert.equal(fs.existsSync(guidanceDir), true);
  });

  it('writes a file at <guidanceDir>/guidance-<storyId>.md', () => {
    const tmpDir = makeTmpDir();
    const guidanceDir = path.join(tmpDir, 'guidance');

    saveGuidance('US-003', sampleContext, guidanceDir);

    const expectedPath = path.join(guidanceDir, 'guidance-US-003.md');
    assert.equal(fs.existsSync(expectedPath), true);
  });

  it('returns the file path where guidance was written', () => {
    const tmpDir = makeTmpDir();
    const guidanceDir = path.join(tmpDir, 'guidance');

    const result = saveGuidance('US-003', sampleContext, guidanceDir);
    assert.equal(result, path.join(guidanceDir, 'guidance-US-003.md'));
  });

  it('writes correct content with all sections', () => {
    const tmpDir = makeTmpDir();
    const guidanceDir = path.join(tmpDir, 'guidance');

    saveGuidance('US-003', sampleContext, guidanceDir);

    const content = fs.readFileSync(path.join(guidanceDir, 'guidance-US-003.md'), 'utf-8');
    assert.match(content, /# Story Guidance/);
    assert.match(content, /Token refresh not implemented/);
    assert.match(content, /refreshToken endpoint/);
    assert.match(content, /api\/refresh/);
  });

  it('overwrites an existing guidance file', () => {
    const tmpDir = makeTmpDir();
    const guidanceDir = path.join(tmpDir, 'guidance');

    saveGuidance('US-003', sampleContext, guidanceDir);
    saveGuidance('US-003', { ...sampleContext, userInstructions: 'Updated instructions.' }, guidanceDir);

    const content = fs.readFileSync(path.join(guidanceDir, 'guidance-US-003.md'), 'utf-8');
    assert.match(content, /Updated instructions/);
    assert.doesNotMatch(content, /Use the refreshToken endpoint/);
  });

  it('creates nested directories if needed', () => {
    const tmpDir = makeTmpDir();
    const guidanceDir = path.join(tmpDir, 'deep', 'nested', 'guidance');

    saveGuidance('US-003', sampleContext, guidanceDir);
    assert.equal(fs.existsSync(path.join(guidanceDir, 'guidance-US-003.md')), true);
  });
});

// ---------------------------------------------------------------------------
// loadGuidance
// ---------------------------------------------------------------------------

describe('loadGuidance', () => {
  it('returns null when guidance file does not exist', () => {
    const tmpDir = makeTmpDir();
    const guidanceDir = path.join(tmpDir, 'guidance');

    const result = loadGuidance('US-003', guidanceDir);
    assert.equal(result, null);
  });

  it('returns file contents when guidance file exists', () => {
    const tmpDir = makeTmpDir();
    const guidanceDir = path.join(tmpDir, 'guidance');

    saveGuidance('US-003', sampleContext, guidanceDir);
    const result = loadGuidance('US-003', guidanceDir);

    assert.ok(result !== null);
    assert.match(result!, /# Story Guidance/);
    assert.match(result!, /Token refresh not implemented/);
  });

  it('falls back to the legacy <guidanceDir>/<storyId>.md filename', () => {
    const tmpDir = makeTmpDir();
    const guidanceDir = path.join(tmpDir, 'guidance');

    fs.mkdirSync(guidanceDir, { recursive: true });
    fs.writeFileSync(path.join(guidanceDir, 'US-003.md'), '# Legacy Guidance\n\nOld format', 'utf-8');

    const result = loadGuidance('US-003', guidanceDir);

    assert.equal(result, '# Legacy Guidance\n\nOld format');
  });

  it('returns null for a different story ID even if another exists', () => {
    const tmpDir = makeTmpDir();
    const guidanceDir = path.join(tmpDir, 'guidance');

    saveGuidance('US-003', sampleContext, guidanceDir);
    const result = loadGuidance('US-099', guidanceDir);

    assert.equal(result, null);
  });

  it('uses default guidance dir when none specified', () => {
    // Just verify the path resolution does not throw
    // (we cannot test the actual default dir 'guidance' without touching the real fs)
    const result = loadGuidance('US-NONEXISTENT-STORY-12345678');
    assert.equal(result, null);
  });
});
