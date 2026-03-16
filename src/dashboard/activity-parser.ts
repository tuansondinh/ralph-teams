/**
 * dashboard/activity-parser.ts — Parses agent log files for activity signals.
 *
 * Supports Claude stream-json format (type: "assistant" lines with tool_use
 * content blocks) and Copilot text-format logs.
 *
 * readLogTail reads only the tail of a log file using an OS-level seek,
 * avoiding full reads of multi-MB logs on every poll tick.
 */

import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single parsed activity signal extracted from a log. */
export interface ActivitySignal {
  type: 'file-edit' | 'test-run' | 'commit' | 'tool-call' | 'idle';
  /** Human-readable detail string, e.g. 'src/api.ts', 'npm test', 'abc1234' */
  detail: string;
  /** When this signal was observed (best-effort from log content, or parse time) */
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Spinner state
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['-', '\\', '|', '/'];
let _spinnerIndex = 0;

/** Returns the next spinner character and advances the internal counter. */
export function nextSpinnerChar(): string {
  const ch = SPINNER_FRAMES[_spinnerIndex % SPINNER_FRAMES.length];
  _spinnerIndex++;
  return ch;
}

/** Resets spinner to first frame (useful in tests). */
export function resetSpinner(): void {
  _spinnerIndex = 0;
}

// ---------------------------------------------------------------------------
// Tool-name → activity string mapping
// ---------------------------------------------------------------------------

/**
 * Maps a Claude tool_use name + input to a display string.
 *
 * Bash tool:
 *   - command contains test/jest/vitest/mocha/deno test/npm test/node test -> 'running tests'
 *   - command contains 'git commit' -> 'committing'
 *   - otherwise -> 'running: <first 40 chars of command>'
 *
 * Edit/Write/MultiEdit tools:
 *   - extract file_path from input -> 'editing <basename>'
 *
 * Read tool:
 *   - -> 'reading <basename>'
 *
 * Other tools:
 *   - -> 'using <tool_name>'
 */
export function toolCallToActivity(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  const name = toolName.toLowerCase();

  // File editing tools
  if (name === 'edit' || name === 'write' || name === 'multiedit' || name === 'str_replace_editor') {
    const filePath = (toolInput['file_path'] ?? toolInput['path'] ?? '') as string;
    if (filePath) {
      const base = filePath.split('/').pop() ?? filePath;
      return `editing ${base}`;
    }
    return 'editing file';
  }

  // Read tool
  if (name === 'read' || name === 'str_replace_based_edit_tool') {
    const filePath = (toolInput['file_path'] ?? toolInput['path'] ?? '') as string;
    if (filePath) {
      const base = filePath.split('/').pop() ?? filePath;
      return `reading ${base}`;
    }
    return 'reading file';
  }

  // Bash/shell tool
  if (name === 'bash' || name === 'shell' || name === 'execute_command') {
    const command = (toolInput['command'] ?? toolInput['cmd'] ?? '') as string;
    if (command) {
      if (/\b(jest|vitest|mocha|deno\s+test|npm\s+test|node\s+.*test|npx\s+.*test|yarn\s+test)\b/i.test(command)) {
        return 'running tests';
      }
      if (/git\s+commit/i.test(command)) {
        return 'committing';
      }
      if (/git\s+add/i.test(command)) {
        return 'staging files';
      }
      if (/npm\s+install|yarn\s+install|pnpm\s+install/i.test(command)) {
        return 'installing deps';
      }
      // Generic: show first 40 chars of command
      const preview = command.trim().substring(0, 40);
      return `running: ${preview}`;
    }
    return 'running command';
  }

  // Glob/search tools
  if (name === 'glob' || name === 'grep' || name === 'search') {
    return 'searching files';
  }

  // Agent/task spawning
  if (name === 'agent' || name === 'task' || name === 'spawn') {
    return 'spawning agent';
  }

  // Default
  return `using ${toolName}`;
}

// ---------------------------------------------------------------------------
// Stream-json line parsing
// ---------------------------------------------------------------------------

/**
 * Parsed content from a single stream-json log line.
 * Returns null if the line doesn't contain useful activity info.
 */
interface ParsedStreamLine {
  activity: string;
  timestampMs: number | null;
}

/**
 * Attempts to extract visible assistant text from a single Claude stream-json
 * line. Returns the last non-empty text content block, or null.
 */
export function parseStreamJsonTextLine(line: string): ParsedStreamLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  if (obj['type'] !== 'assistant') return null;

  const message = obj['message'];
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const msgObj = message as Record<string, unknown>;

  const content = msgObj['content'];
  if (!Array.isArray(content)) return null;

  let latestText: string | null = null;
  for (const block of content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const blockObj = block as Record<string, unknown>;
    if (blockObj['type'] !== 'text' || typeof blockObj['text'] !== 'string') continue;

    const lines = blockObj['text']
      .split('\n')
      .map(textLine => textLine.trim())
      .filter(textLine => textLine.length > 0);
    if (lines.length > 0) {
      latestText = lines[lines.length - 1];
    }
  }

  if (!latestText) return null;

  const ts = typeof obj['timestamp'] === 'string'
    ? new Date(obj['timestamp']).getTime()
    : null;

  return { activity: latestText, timestampMs: isNaN(ts ?? NaN) ? null : ts };
}

/**
 * Attempts to parse a single JSON log line from a Claude stream-json file.
 * Returns the activity string if the line contains a tool_use block, or null.
 */
export function parseStreamJsonLine(line: string): ParsedStreamLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  // Only inspect assistant messages
  if (obj['type'] !== 'assistant') return null;

  const message = obj['message'];
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const msgObj = message as Record<string, unknown>;

  const content = msgObj['content'];
  if (!Array.isArray(content)) return null;

  // Find tool_use blocks in message content
  for (const block of content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const blockObj = block as Record<string, unknown>;
    if (blockObj['type'] !== 'tool_use') continue;

    const toolName = typeof blockObj['name'] === 'string' ? blockObj['name'] : '';
    if (!toolName) continue;

    const input = (blockObj['input'] && typeof blockObj['input'] === 'object' && !Array.isArray(blockObj['input']))
      ? (blockObj['input'] as Record<string, unknown>)
      : {};

    const activity = toolCallToActivity(toolName, input);

    // Extract timestamp if present (some log formats embed it)
    const ts = typeof obj['timestamp'] === 'string'
      ? new Date(obj['timestamp']).getTime()
      : null;

    return { activity, timestampMs: isNaN(ts ?? NaN) ? null : ts };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Copilot text-format log parsing
// ---------------------------------------------------------------------------

/**
 * Detects activity from a single line of copilot text-format output.
 * Returns a display string or null.
 */
export function parseCopilotLine(line: string): string | null {
  // Common copilot output patterns
  if (/editing\s+file[:\s]+(\S+)/i.test(line)) {
    const m = /editing\s+file[:\s]+(\S+)/i.exec(line);
    const base = (m?.[1] ?? '').split('/').pop() ?? '';
    return base ? `editing ${base}` : 'editing file';
  }
  if (/running\s+command[:\s]+(.+)/i.test(line)) {
    const m = /running\s+command[:\s]+(.{1,40})/i.exec(line);
    return m ? `running: ${m[1].trim()}` : 'running command';
  }
  if (/running tests/i.test(line) || /npm test/i.test(line) || /jest|vitest/i.test(line)) {
    return 'running tests';
  }
  if (/git commit/i.test(line)) {
    return 'committing';
  }
  if (/git add/i.test(line)) {
    return 'staging files';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main parsing entry points
// ---------------------------------------------------------------------------

/**
 * How many seconds of inactivity before we report 'idle'.
 */
const IDLE_THRESHOLD_SECONDS = 30;
const IDLE_THRESHOLD_MS = IDLE_THRESHOLD_SECONDS * 1000;

/**
 * Parses the last N lines of a log file (already read as a string) and
 * returns the most recent activity signal as a display string.
 *
 * For Claude stream-json logs: scans for the most recent tool_use block.
 * For Copilot text logs: scans for known pattern keywords.
 * Falls back to 'idle <spinner>' if no recent activity found.
 *
 * @param logTail - Content string (typically the tail of the log file)
 * @param backend - 'claude' or 'copilot'
 * @param nowMs - Current time in ms (injectable for testing, defaults to Date.now())
 */
export function parseLatestActivity(
  logTail: string,
  backend: string,
  nowMs: number = Date.now(),
): string {
  if (!logTail || logTail.trim() === '') {
    return `idle ${nextSpinnerChar()}`;
  }

  const lines = logTail.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    return `idle ${nextSpinnerChar()}`;
  }

  if (backend === 'claude') {
    // Prefer the latest visible assistant text from the team lead.
    for (let i = lines.length - 1; i >= 0; i--) {
      const textResult = parseStreamJsonTextLine(lines[i]);
      if (textResult) {
        return textResult.activity;
      }
    }

    // Fall back to tool-use derived activity when no text was emitted.
    for (let i = lines.length - 1; i >= 0; i--) {
      const result = parseStreamJsonLine(lines[i]);
      if (result) {
        if (result.timestampMs !== null && nowMs - result.timestampMs > IDLE_THRESHOLD_MS) {
          return `idle ${nextSpinnerChar()}`;
        }
        return result.activity;
      }
    }

    return `idle ${nextSpinnerChar()}`;
  }

  // Text backends: show the most recent non-empty visible line from the log.
  for (let i = lines.length - 1; i >= 0; i--) {
    const latestLine = lines[i].trim();
    if (latestLine.length > 0) return latestLine;
  }

  return `idle ${nextSpinnerChar()}`;
}

// ---------------------------------------------------------------------------
// Log file tail reader
// ---------------------------------------------------------------------------

/** How many bytes to read from the end of large log files. */
const LOG_TAIL_BYTES = 8192;

/**
 * Reads the tail of a log file efficiently by seeking to near the end.
 *
 * Uses fs.openSync + fs.readSync to read at most LOG_TAIL_BYTES bytes from
 * the end of the file, then splits into lines and returns the last `lineCount`
 * non-empty lines joined by newline. For small files (< LOG_TAIL_BYTES), reads
 * the whole file.
 *
 * @param logFilePath - Absolute path to the log file
 * @param lineCount - Maximum number of lines to return (default: 50)
 * @returns Content string (last N lines), or empty string if file not found
 */
export function readLogTail(logFilePath: string, lineCount: number = 50): string {
  let fd: number;
  try {
    fd = fs.openSync(logFilePath, 'r');
  } catch {
    return '';
  }

  try {
    // Get file size
    const stat = fs.fstatSync(fd);
    const fileSize = stat.size;

    if (fileSize === 0) return '';

    // Calculate read offset: start from end minus LOG_TAIL_BYTES
    const readBytes = Math.min(fileSize, LOG_TAIL_BYTES);
    const offset = fileSize - readBytes;

    const buffer = Buffer.allocUnsafe(readBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, readBytes, offset);
    const content = buffer.subarray(0, bytesRead).toString('utf-8');

    // Split into lines, drop partial first line if we didn't start at byte 0
    const lines = content.split('\n');
    const start = offset > 0 ? 1 : 0; // skip potentially partial first line
    const tail = lines.slice(start).filter(l => l.trim().length > 0);

    // Return last lineCount lines
    return tail.slice(-lineCount).join('\n');
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Log file discovery
// ---------------------------------------------------------------------------

/**
 * Finds the most recent log file for a given epic ID in the logs directory.
 *
 * Log files are named: epic-{EPIC_ID}-{timestamp}.log
 * Returns the path of the file with the highest timestamp suffix, or null.
 *
 * @param logsDir - Directory to scan (e.g. './logs')
 * @param epicId - Epic ID to search for (e.g. 'EPIC-001')
 */
export function findLatestEpicLog(logsDir: string, epicId: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(logsDir);
  } catch {
    return null;
  }

  const prefix = `epic-${epicId}-`;
  const suffix = '.log';
  const matching = entries
    .filter(e => e.startsWith(prefix) && e.endsWith(suffix))
    .sort(); // lexicographic sort works because timestamps are numeric and zero-padded

  if (matching.length === 0) return null;
  return `${logsDir}/${matching[matching.length - 1]}`;
}
