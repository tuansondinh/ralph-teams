#!/usr/bin/env node
/**
 * rjq — A pure Node.js JSON query/manipulation CLI.
 * Replaces jq dependency in ralph.sh.
 *
 * Usage: rjq <subcommand> [args...]
 *
 * Subcommands:
 *   read <file> <path> [default]           Read a value at a JSON path
 *   set <file> <path> <value>              Set a value at a JSON path (in-place)
 *   length <file> <path>                   Output length of array at path
 *   list <file> <path>                     Output each element one per line
 *   count-where <file> <path> <conditions> Count objects matching conditions
 *   count-matches <file> <path> <value>    Count elements equal to value
 *   find-index <file> <path> <field> <val> Find index of first matching object
 *   read-where <file> <path> <mf> <mv> <rf> [default]  Read field from matched object
 *   validate                               Read one line from stdin, validate JSON
 *   extract-stream-text                    Extract text from Claude stream-json line
 */

import * as fs from 'fs';

// ─── Path parsing ─────────────────────────────────────────────────────────────

interface PathSegment {
  key: string;
  index?: number;
}

/**
 * Parse a jq-style path string like `.epics[0].userStories[2].id`
 * into an array of segments.
 */
function parsePath(pathStr: string): PathSegment[] {
  // Remove leading dot
  const cleaned = pathStr.startsWith('.') ? pathStr.slice(1) : pathStr;
  if (cleaned === '') return [];

  const segments: PathSegment[] = [];
  // Split on dots, but be careful of array notation
  const parts = cleaned.split('.');

  for (const part of parts) {
    if (part === '') continue;
    // Check for array index suffix: key[N]
    const bracketMatch = part.match(/^([^\[]*)\[(\d+)\]$/);
    if (bracketMatch) {
      const key = bracketMatch[1];
      const index = parseInt(bracketMatch[2], 10);
      if (key !== '') {
        segments.push({ key });
      }
      segments.push({ key: '', index });
    } else {
      segments.push({ key: part });
    }
  }

  return segments;
}

/**
 * Traverse a parsed JSON object using path segments.
 * Returns the value at the path, or undefined if not found.
 */
function traverse(obj: unknown, segments: PathSegment[]): unknown {
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (seg.index !== undefined) {
      if (!Array.isArray(current)) return undefined;
      current = current[seg.index];
    } else {
      if (typeof current !== 'object' || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[seg.key];
    }
  }
  return current;
}

/**
 * Set a value at a path within an object (mutates in-place).
 * Creates intermediate objects if needed.
 */
function setAtPath(obj: unknown, segments: PathSegment[], value: unknown): unknown {
  if (segments.length === 0) return value;

  const seg = segments[0];
  const rest = segments.slice(1);

  if (seg.index !== undefined) {
    const arr = Array.isArray(obj) ? [...(obj as unknown[])] : [];
    arr[seg.index] = setAtPath(arr[seg.index], rest, value);
    return arr;
  } else {
    const record = (typeof obj === 'object' && obj !== null && !Array.isArray(obj))
      ? { ...(obj as Record<string, unknown>) }
      : {} as Record<string, unknown>;
    record[seg.key] = setAtPath(record[seg.key], rest, value);
    return record;
  }
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

function readJson(file: string): unknown {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    process.stderr.write(`rjq: error reading ${file}: ${e}\n`);
    process.exit(1);
  }
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

// ─── Output helpers ───────────────────────────────────────────────────────────

/**
 * Output a value: raw string for strings, JSON for everything else.
 */
function outputValue(value: unknown): void {
  if (typeof value === 'string') {
    process.stdout.write(value + '\n');
  } else {
    process.stdout.write(JSON.stringify(value) + '\n');
  }
}

// ─── Condition parser for count-where ────────────────────────────────────────

interface Condition {
  field: string;
  values: string[];       // OR semantics
  defaultValue?: string;
}

/**
 * Parse conditions like "field=value" or "field=val1|val2".
 * Also accepts a --default flag in the args array.
 */
function parseConditions(condArgs: string[]): Condition[] {
  const conditions: Condition[] = [];
  let i = 0;
  while (i < condArgs.length) {
    const arg = condArgs[i];
    if (arg === '--default') {
      // Attach the default to the last condition
      if (conditions.length > 0 && i + 1 < condArgs.length) {
        conditions[conditions.length - 1].defaultValue = condArgs[i + 1];
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    // Parse "field=value" or "field=val1|val2"
    const eqIdx = arg.indexOf('=');
    if (eqIdx === -1) {
      i++;
      continue;
    }
    const field = arg.slice(0, eqIdx);
    const valStr = arg.slice(eqIdx + 1);
    const values = valStr.split('|');
    conditions.push({ field, values });
    i++;
  }
  return conditions;
}

/**
 * Check if an object matches all conditions (AND semantics across conditions,
 * OR semantics within each condition's values).
 */
function matchesConditions(obj: unknown, conditions: Condition[]): boolean {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  const record = obj as Record<string, unknown>;
  for (const cond of conditions) {
    const rawVal = record[cond.field];
    const effectiveVal = (rawVal === undefined || rawVal === null)
      ? (cond.defaultValue ?? 'null')
      : String(rawVal);
    // For boolean values (passes=true), handle boolean comparison
    let matched = false;
    for (const v of cond.values) {
      if (effectiveVal === v) {
        matched = true;
        break;
      }
      // Handle boolean: passes=true should match boolean true
      if (v === 'true' && rawVal === true) { matched = true; break; }
      if (v === 'false' && rawVal === false) { matched = true; break; }
    }
    if (!matched) return false;
  }
  return true;
}

// ─── Subcommands ──────────────────────────────────────────────────────────────

function cmdRead(args: string[]): void {
  // read <file> <path> [default]
  const [file, pathStr, defaultVal] = args;
  if (!file || !pathStr) {
    process.stderr.write('rjq read: requires <file> <path> [default]\n');
    process.exit(1);
  }

  const obj = readJson(file);
  const segments = parsePath(pathStr);
  const value = traverse(obj, segments);

  if (value === undefined || value === null) {
    if (defaultVal !== undefined) {
      process.stdout.write(defaultVal + '\n');
    } else {
      process.stdout.write('null\n');
    }
    return;
  }

  outputValue(value);
}

function cmdSet(args: string[]): void {
  // set <file> <path> <value>
  const [file, pathStr, rawValue] = args;
  if (!file || !pathStr || rawValue === undefined) {
    process.stderr.write('rjq set: requires <file> <path> <value>\n');
    process.exit(1);
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    parsedValue = rawValue;
  }

  const lockFile = file + '.lock';
  const maxAttempts = 50;
  const retryDelay = 100; // ms
  let lockFd: number | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      break;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        // Check if lock is stale (older than 10 seconds)
        try {
          const stat = fs.statSync(lockFile);
          if (Date.now() - stat.mtimeMs > 10000) {
            fs.unlinkSync(lockFile);
            continue;
          }
        } catch {
          // Lock file disappeared — retry
          continue;
        }
        // Busy-wait with jitter
        const jitter = Math.floor(Math.random() * 50);
        const start = Date.now();
        while (Date.now() - start < retryDelay + jitter) {
          // spin
        }
        continue;
      }
      throw e;
    }
  }

  if (lockFd === undefined) {
    process.stderr.write(`rjq set: could not acquire lock on ${file} after ${maxAttempts} attempts\n`);
    process.exit(1);
  }

  try {
    // Read-modify-write under lock
    const obj = readJson(file);
    const segments = parsePath(pathStr);
    const updated = setAtPath(obj, segments, parsedValue);
    // Write to temp file then rename for atomicity
    const tmpFile = file + '.tmp.' + process.pid;
    fs.writeFileSync(tmpFile, JSON.stringify(updated, null, 2) + '\n');
    fs.renameSync(tmpFile, file);
  } finally {
    fs.closeSync(lockFd);
    try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
  }
}

function cmdLength(args: string[]): void {
  // length <file> <path>
  const [file, pathStr] = args;
  if (!file || !pathStr) {
    process.stderr.write('rjq length: requires <file> <path>\n');
    process.exit(1);
  }

  const obj = readJson(file);
  const segments = parsePath(pathStr);
  const value = traverse(obj, segments);

  if (!Array.isArray(value)) {
    process.stdout.write('0\n');
    return;
  }
  process.stdout.write(String(value.length) + '\n');
}

function cmdList(args: string[]): void {
  // list <file> <path>
  const [file, pathStr] = args;
  if (!file || !pathStr) {
    process.stderr.write('rjq list: requires <file> <path>\n');
    process.exit(1);
  }

  const obj = readJson(file);
  const segments = parsePath(pathStr);
  const value = traverse(obj, segments);

  if (!Array.isArray(value)) {
    return; // output nothing
  }

  for (const item of value) {
    outputValue(item);
  }
}

function cmdCountWhere(args: string[]): void {
  // count-where <file> <path> <conditions...> [--default <val>]
  const [file, pathStr, ...rest] = args;
  if (!file || !pathStr || rest.length === 0) {
    process.stderr.write('rjq count-where: requires <file> <path> <conditions>\n');
    process.exit(1);
  }

  const obj = readJson(file);
  const segments = parsePath(pathStr);
  const value = traverse(obj, segments);

  if (!Array.isArray(value)) {
    process.stdout.write('0\n');
    return;
  }

  const conditions = parseConditions(rest);
  let count = 0;
  for (const item of value) {
    if (matchesConditions(item, conditions)) count++;
  }
  process.stdout.write(String(count) + '\n');
}

function cmdCountMatches(args: string[]): void {
  // count-matches <file> <path> <value>
  const [file, pathStr, matchValue] = args;
  if (!file || !pathStr || matchValue === undefined) {
    process.stderr.write('rjq count-matches: requires <file> <path> <value>\n');
    process.exit(1);
  }

  const obj = readJson(file);
  const segments = parsePath(pathStr);
  const value = traverse(obj, segments);

  if (!Array.isArray(value)) {
    process.stdout.write('0\n');
    return;
  }

  let count = 0;
  for (const item of value) {
    if (item === matchValue) count++;
  }
  process.stdout.write(String(count) + '\n');
}

function cmdFindIndex(args: string[]): void {
  // find-index <file> <path> <field> <value>
  const [file, pathStr, field, matchValue] = args;
  if (!file || !pathStr || !field || matchValue === undefined) {
    process.stderr.write('rjq find-index: requires <file> <path> <field> <value>\n');
    process.exit(1);
  }

  const obj = readJson(file);
  const segments = parsePath(pathStr);
  const value = traverse(obj, segments);

  if (!Array.isArray(value)) {
    process.stdout.write('\n');
    return;
  }

  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if (String(record[field]) === matchValue) {
        process.stdout.write(String(i) + '\n');
        return;
      }
    }
  }
  process.stdout.write('\n');
}

function cmdReadWhere(args: string[]): void {
  // read-where <file> <path> <matchField> <matchValue> <readField> [default]
  const [file, pathStr, matchField, matchValue, readField, defaultVal] = args;
  if (!file || !pathStr || !matchField || matchValue === undefined || !readField) {
    process.stderr.write('rjq read-where: requires <file> <path> <matchField> <matchValue> <readField> [default]\n');
    process.exit(1);
  }

  const obj = readJson(file);
  const segments = parsePath(pathStr);
  const value = traverse(obj, segments);

  if (!Array.isArray(value)) {
    if (defaultVal !== undefined) {
      process.stdout.write(defaultVal + '\n');
    }
    return;
  }

  for (const item of value) {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const fieldVal = record[matchField];
      if (String(fieldVal) === matchValue) {
        const result = record[readField];
        if (result === undefined || result === null) {
          if (defaultVal !== undefined) {
            process.stdout.write(defaultVal + '\n');
          } else {
            process.stdout.write('null\n');
          }
        } else {
          outputValue(result);
        }
        return;
      }
    }
  }

  // Not found
  if (defaultVal !== undefined) {
    process.stdout.write(defaultVal + '\n');
  }
}

function cmdValidate(): void {
  // Read one line from stdin, exit 0 if valid JSON, exit 1 if not
  let input = '';
  try {
    // Read from stdin synchronously
    const buf = Buffer.alloc(65536);
    let totalRead = 0;
    let bytesRead: number;
    // Read until newline or EOF
    while (true) {
      try {
        bytesRead = fs.readSync(0, buf, totalRead, 1, null);
        if (bytesRead === 0) break;
        const ch = buf[totalRead];
        totalRead += bytesRead;
        if (ch === 10) break; // newline
      } catch {
        break;
      }
    }
    input = buf.slice(0, totalRead).toString('utf-8').trim();
  } catch {
    process.exit(1);
  }

  try {
    JSON.parse(input);
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

function cmdExtractStreamText(): void {
  // Read one line from stdin (Claude stream-json format).
  // If it's a valid assistant message with text content, output each text line.
  let input = '';
  try {
    const buf = Buffer.alloc(1024 * 1024); // 1MB buffer for potentially long lines
    let totalRead = 0;
    let bytesRead: number;
    while (true) {
      try {
        bytesRead = fs.readSync(0, buf, totalRead, 1, null);
        if (bytesRead === 0) break;
        const ch = buf[totalRead];
        totalRead += bytesRead;
        if (ch === 10) break; // newline
      } catch {
        break;
      }
    }
    input = buf.slice(0, totalRead).toString('utf-8').trim();
  } catch {
    return; // no output on error
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return; // not valid JSON, output nothing
  }

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed)
  ) {
    const record = parsed as Record<string, unknown>;
    if (
      record['type'] === 'assistant' &&
      Array.isArray(record['message'] && (record['message'] as Record<string, unknown>)['content'])
    ) {
      const content = (record['message'] as Record<string, unknown>)['content'] as unknown[];
      for (const item of content) {
        if (
          typeof item === 'object' &&
          item !== null &&
          !Array.isArray(item)
        ) {
          const contentItem = item as Record<string, unknown>;
          if (contentItem['type'] === 'text' && typeof contentItem['text'] === 'string') {
            process.stdout.write(contentItem['text'] + '\n');
          }
        }
      }
      return;
    }

    const extractNestedMessage = (value: unknown): string | null => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
      }
      const nested = value as Record<string, unknown>;
      if (typeof nested['message'] === 'string' && nested['message'].trim() !== '') {
        return nested['message'];
      }
      return null;
    };

    const directError = extractNestedMessage(record['error']);
    if (directError !== null) {
      process.stdout.write(`ERROR: ${directError}\n`);
      return;
    }

    const dataError = extractNestedMessage(record['data']);
    if (dataError !== null) {
      process.stdout.write(`ERROR: ${dataError}\n`);
      return;
    }

    if (typeof record['responseBody'] === 'string') {
      try {
        const responseParsed = JSON.parse(record['responseBody']);
        const responseError = extractNestedMessage((responseParsed as Record<string, unknown>)['error']);
        if (responseError !== null) {
          process.stdout.write(`ERROR: ${responseError}\n`);
          return;
        }
      } catch {
        // ignore malformed nested response bodies
      }
    }
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

const [, , subcommand, ...restArgs] = process.argv;

switch (subcommand) {
  case 'read':
    cmdRead(restArgs);
    break;
  case 'set':
    cmdSet(restArgs);
    break;
  case 'length':
    cmdLength(restArgs);
    break;
  case 'list':
    cmdList(restArgs);
    break;
  case 'count-where':
    cmdCountWhere(restArgs);
    break;
  case 'count-matches':
    cmdCountMatches(restArgs);
    break;
  case 'find-index':
    cmdFindIndex(restArgs);
    break;
  case 'read-where':
    cmdReadWhere(restArgs);
    break;
  case 'validate':
    cmdValidate();
    break;
  case 'extract-stream-text':
    cmdExtractStreamText();
    break;
  default:
    process.stderr.write(`rjq: unknown subcommand '${subcommand}'\n`);
    process.stderr.write('Available: read, set, length, list, count-where, count-matches, find-index, read-where, validate, extract-stream-text\n');
    process.exit(1);
}
