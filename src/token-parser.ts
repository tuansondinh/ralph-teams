import * as fs from 'node:fs';

/**
 * Aggregated token usage parsed from a Claude CLI stream-json log file.
 * All fields are null when no usage data is available (e.g. copilot backend).
 */
export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
}

/** Returns an all-null TokenUsage object. */
function nullUsage(): TokenUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheCreationInputTokens: null,
    cacheReadInputTokens: null,
  };
}

/**
 * Parses token usage totals from Claude CLI stream-json log content.
 *
 * Each line of the log is a JSON object. Lines with `type === "assistant"` carry
 * a `message.usage` object with snake_case token counts. Multiple lines may share
 * the same top-level `uuid` (streaming chunks of the same message) — we deduplicate
 * by uuid, keeping the last occurrence, then sum across unique messages.
 *
 * For the `copilot` backend, no structured token data is available, so all-null
 * values are returned immediately.
 *
 * @param logContent - Raw string content of the log file (newline-separated JSON)
 * @param backend - The backend that produced the log ('claude' | 'copilot')
 * @returns Aggregated token counts, or all-null if unavailable
 */
export function parseTokenUsageFromLog(logContent: string, backend: string): TokenUsage {
  if (backend !== 'claude') {
    return nullUsage();
  }

  if (!logContent || logContent.trim() === '') {
    return nullUsage();
  }

  // Map from uuid -> last-seen usage object for that message
  const seenByUuid = new Map<string, {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }>();

  // Track lines that have no uuid separately (still count them once)
  const noUuidEntries: Array<{
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }> = [];

  for (const line of logContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Skip malformed JSON lines
      continue;
    }

    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      continue;
    }

    const obj = parsed as Record<string, unknown>;

    if (obj['type'] !== 'assistant') continue;

    const message = obj['message'];
    if (message === null || typeof message !== 'object' || Array.isArray(message)) continue;

    const msgObj = message as Record<string, unknown>;
    const usage = msgObj['usage'];
    if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) continue;

    const usageObj = usage as Record<string, unknown>;

    const entry = {
      input_tokens: typeof usageObj['input_tokens'] === 'number' ? usageObj['input_tokens'] as number : undefined,
      output_tokens: typeof usageObj['output_tokens'] === 'number' ? usageObj['output_tokens'] as number : undefined,
      cache_creation_input_tokens: typeof usageObj['cache_creation_input_tokens'] === 'number' ? usageObj['cache_creation_input_tokens'] as number : undefined,
      cache_read_input_tokens: typeof usageObj['cache_read_input_tokens'] === 'number' ? usageObj['cache_read_input_tokens'] as number : undefined,
    };

    const uuid = typeof obj['uuid'] === 'string' ? obj['uuid'] : null;

    if (uuid !== null) {
      // Overwrite with latest occurrence for this uuid (deduplication)
      seenByUuid.set(uuid, entry);
    } else {
      noUuidEntries.push(entry);
    }
  }

  const allEntries = [...seenByUuid.values(), ...noUuidEntries];

  if (allEntries.length === 0) {
    return nullUsage();
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let hasAnyData = false;

  for (const entry of allEntries) {
    if (entry.input_tokens !== undefined) { inputTokens += entry.input_tokens; hasAnyData = true; }
    if (entry.output_tokens !== undefined) { outputTokens += entry.output_tokens; hasAnyData = true; }
    if (entry.cache_creation_input_tokens !== undefined) { cacheCreationInputTokens += entry.cache_creation_input_tokens; hasAnyData = true; }
    if (entry.cache_read_input_tokens !== undefined) { cacheReadInputTokens += entry.cache_read_input_tokens; hasAnyData = true; }
  }

  if (!hasAnyData) {
    return nullUsage();
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
  };
}

/**
 * Convenience wrapper that reads a log file from disk and calls `parseTokenUsageFromLog`.
 *
 * Returns all-null TokenUsage if the file does not exist or cannot be read.
 *
 * @param logFilePath - Absolute path to the Claude CLI log file
 * @param backend - The backend that produced the log ('claude' | 'copilot')
 * @returns Aggregated token counts, or all-null if unavailable
 */
export function parseTokenUsageFromFile(logFilePath: string, backend: string): TokenUsage {
  if (!fs.existsSync(logFilePath)) {
    return nullUsage();
  }

  let content: string;
  try {
    content = fs.readFileSync(logFilePath, 'utf-8');
  } catch {
    return nullUsage();
  }

  return parseTokenUsageFromLog(content, backend);
}
