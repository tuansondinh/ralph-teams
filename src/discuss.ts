/**
 * discuss.ts — Discuss agent for failed user stories.
 *
 * Gathers context (failure report, code diff, plan section) for a failed story
 * and runs an interactive agent session so the user can have a back-and-forth
 * conversation about the failure and provide guidance for the next attempt.
 *
 * The discuss session spawns the configured AI CLI (claude by default) as a
 * subprocess, passing the failure context as the initial system prompt and
 * piping stdin/stdout so the user can interact directly with the agent.
 *
 * The session ends when:
 *   - The user types 'done' or 'exit' in the conversation
 *   - The user presses Escape (raw mode keypress detection)
 *   - The agent subprocess exits
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, spawn, ChildProcess } from 'child_process';
import { saveGuidance } from './guidance';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscussContext {
  /** The user story ID being discussed (e.g. 'US-018') */
  storyId: string;
  /** The epic ID this story belongs to (e.g. 'EPIC-004') */
  epicId: string;
  /** Failure details parsed from progress.txt */
  failureReport: string;
  /** Git diff of commits relevant to this story */
  codeDiff: string;
  /** The section of the plan file that describes this story */
  planSection: string;
}

export interface DiscussResult {
  /** The story ID that was discussed */
  storyId: string;
  /** Concatenated user guidance from the session */
  guidance: string;
}

/**
 * A function that spawns a discuss agent for the given context prompt and
 * returns a Promise that resolves with any captured guidance when the session ends.
 *
 * Injectable for testing — the default implementation spawns `claude` in
 * interactive mode so the user can converse directly with the AI.
 */
export type AgentSpawner = (contextPrompt: string) => Promise<string>;

export interface DiscussSessionOptions {
  /**
   * Injectable agent spawner function. When omitted, the default spawner
   * runs `claude` in interactive mode with the context as the initial prompt.
   */
  spawnAgent?: AgentSpawner;
  /**
   * Directory in which to persist the guidance file after the session ends.
   * When provided, the guidance is saved to `<guidanceDir>/guidance-<storyId>.md`.
   * Defaults to 'guidance' if not specified.
   */
  guidanceDir?: string;
}

// ---------------------------------------------------------------------------
// Context gathering
// ---------------------------------------------------------------------------

/**
 * Parses progress.txt and extracts all lines related to a given story ID.
 *
 * A progress.txt entry starts with a `##` heading that contains the story ID
 * and continues until the next `---` separator.
 *
 * @param progressPath - Absolute path to progress.txt
 * @param storyId - Story ID to search for (e.g. 'US-018')
 */
export function parseFailureReport(progressPath: string, storyId: string): string {
  if (!fs.existsSync(progressPath)) {
    return '(progress.txt not found)';
  }

  const content = fs.readFileSync(progressPath, 'utf-8');
  const sections = content.split(/\n---\n/);

  // Collect all sections that mention this story ID and contain a FAIL result
  const relevant: string[] = [];
  for (const section of sections) {
    if (section.includes(storyId) && section.includes('Result: FAIL')) {
      relevant.push(section.trim());
    }
  }

  if (relevant.length === 0) {
    // Fallback: return any section mentioning this story
    for (const section of sections) {
      if (section.includes(storyId)) {
        relevant.push(section.trim());
        break;
      }
    }
  }

  return relevant.length > 0
    ? relevant.join('\n\n---\n\n')
    : `(no progress entry found for ${storyId})`;
}

/**
 * Extracts the plan section for a specific story from a plan markdown file.
 *
 * Looks for a heading that contains the story ID and returns all content
 * until the next same-or-higher-level heading.
 *
 * @param plansDir - Directory containing plan files (e.g. 'plans/')
 * @param epicId - Epic ID used to construct the plan filename
 * @param storyId - Story ID to find in the plan
 */
export function extractPlanSection(plansDir: string, epicId: string, storyId: string): string {
  const planFile = path.join(plansDir, `plan-${epicId}.md`);
  if (!fs.existsSync(planFile)) {
    return `(plan file not found: ${planFile})`;
  }

  const content = fs.readFileSync(planFile, 'utf-8');
  const lines = content.split('\n');

  let inSection = false;
  let sectionLevel = 0;
  const sectionLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];

      if (text.includes(storyId)) {
        // Start capturing this section
        inSection = true;
        sectionLevel = level;
        sectionLines.push(line);
      } else if (inSection && level <= sectionLevel) {
        // End of section: next heading at same or higher level
        break;
      } else if (inSection) {
        sectionLines.push(line);
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  if (sectionLines.length === 0) {
    return `(no plan section found for ${storyId} in ${planFile})`;
  }

  return sectionLines.join('\n').trim();
}

/**
 * Runs `git log --oneline` in worktreeDir and finds commits related to storyId,
 * then returns the diff for those commits.
 *
 * @param worktreeDir - The git worktree directory to run git commands in
 * @param storyId - Story ID to search for in commit messages
 */
export function getCodeDiff(worktreeDir: string, storyId: string): string {
  if (!fs.existsSync(worktreeDir)) {
    return `(worktree directory not found: ${worktreeDir})`;
  }

  // Get recent commit log
  const logResult = spawnSync('git', ['log', '--oneline', '-20'], {
    cwd: worktreeDir,
    encoding: 'utf-8',
  });

  if (logResult.status !== 0) {
    return '(git log failed — not a git repository or no commits)';
  }

  const logOutput = typeof logResult.stdout === 'string' ? logResult.stdout : '';
  const logLines = logOutput.trim().split('\n').filter(Boolean);

  // Find commits mentioning this story ID
  const relevantCommits = logLines.filter(line => line.includes(storyId));

  if (relevantCommits.length === 0) {
    // Fallback: show diff of last 2 commits
    const diffResult = spawnSync('git', ['diff', 'HEAD~2', 'HEAD', '--stat'], {
      cwd: worktreeDir,
      encoding: 'utf-8',
    });
    const fallbackDiff = typeof diffResult.stdout === 'string' ? diffResult.stdout : '';
    return fallbackDiff.trim() || '(no relevant commits found for this story)';
  }

  // Get the SHA of the earliest relevant commit
  const sha = relevantCommits[relevantCommits.length - 1].split(' ')[0];

  // Get diff from that commit's parent to HEAD
  const diffResult = spawnSync('git', ['diff', `${sha}^`, 'HEAD', '--stat'], {
    cwd: worktreeDir,
    encoding: 'utf-8',
  });

  if (diffResult.status !== 0) {
    // Try without parent (first commit case)
    const diffFromRoot = spawnSync('git', ['diff', sha, 'HEAD', '--stat'], {
      cwd: worktreeDir,
      encoding: 'utf-8',
    });
    return typeof diffFromRoot.stdout === 'string'
      ? diffFromRoot.stdout.trim()
      : '(diff failed)';
  }

  return typeof diffResult.stdout === 'string'
    ? diffResult.stdout.trim()
    : '(empty diff)';
}

/**
 * Finds which epic a story belongs to by reading prd.json.
 *
 * @param prdPath - Path to prd.json
 * @param storyId - Story ID to look up
 * @returns The epic ID, or empty string if not found
 */
export function findEpicForStory(prdPath: string, storyId: string): string {
  if (!fs.existsSync(prdPath)) {
    return '';
  }

  try {
    const prd = JSON.parse(fs.readFileSync(prdPath, 'utf-8')) as {
      epics: Array<{ id: string; userStories: Array<{ id: string }> }>;
    };

    for (const epic of prd.epics) {
      for (const story of epic.userStories) {
        if (story.id === storyId) {
          return epic.id;
        }
      }
    }
  } catch {
    // ignore parse errors
  }

  return '';
}

/**
 * Gathers all context needed to discuss a failed story.
 *
 * @param storyId - The story ID to discuss
 * @param prdPath - Path to prd.json
 * @param progressPath - Path to progress.txt
 * @param plansDir - Directory containing plan markdown files
 * @param worktreeDir - Git worktree directory for the epic
 */
export function gatherDiscussContext(
  storyId: string,
  prdPath: string,
  progressPath: string,
  plansDir: string,
  worktreeDir: string,
): DiscussContext {
  const epicId = findEpicForStory(prdPath, storyId);
  const failureReport = parseFailureReport(progressPath, storyId);
  const codeDiff = getCodeDiff(worktreeDir, storyId);
  const planSection = extractPlanSection(plansDir, epicId, storyId);

  return { storyId, epicId, failureReport, codeDiff, planSection };
}

// ---------------------------------------------------------------------------
// Context prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the initial system prompt string that is passed to the AI agent.
 * Contains the failure report, code diff, and plan section for the story.
 *
 * @param context - The discuss context for the failed story
 */
export function buildContextPrompt(context: DiscussContext): string {
  const sep = '─'.repeat(72);
  return [
    `You are a senior engineer reviewing a failed implementation of user story ${context.storyId} (${context.epicId}).`,
    `Help the user understand what went wrong and guide them toward a working solution.`,
    '',
    sep,
    '[Failure Report]',
    sep,
    context.failureReport,
    '',
    sep,
    '[Code Changes (git diff --stat)]',
    sep,
    context.codeDiff,
    '',
    sep,
    '[Plan Section]',
    sep,
    context.planSection,
    '',
    sep,
    'Please analyze the failure and ask the user what aspects they would like to explore.',
    'When the user is ready to finish, they can type "done" or press Escape.',
    sep,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Default agent spawner
// ---------------------------------------------------------------------------

/**
 * Creates the default agent spawner that invokes `claude` (or the configured
 * backend) as an interactive child process.
 *
 * The context prompt is piped to the agent's stdin as the first message.
 * stdin/stdout are inherited so the user can interact directly in the terminal.
 *
 * Escape key is detected via raw mode on process.stdin. When Escape (\x1b)
 * is pressed, the agent subprocess is killed and the session ends.
 *
 * @param agentCommand - The CLI command to run (default: 'claude')
 * @param agentArgs - Additional args to pass to the agent (default: [])
 */
export function createDefaultSpawner(
  agentCommand: string = 'claude',
  agentArgs: string[] = [],
): AgentSpawner {
  return (contextPrompt: string): Promise<string> => {
    return new Promise((resolve) => {
      // Print context header before starting the agent
      const sep = '─'.repeat(72);
      process.stdout.write('\n');
      process.stdout.write(`${sep}\n`);
      process.stdout.write(`Discuss session starting — type your questions, type "done" or press Escape to finish.\n`);
      process.stdout.write(`${sep}\n\n`);

      // Spawn the agent with inherited stdio so user can interact directly
      let agentProcess: ChildProcess;
      try {
        agentProcess = spawn(agentCommand, agentArgs, {
          stdio: ['pipe', 'inherit', 'inherit'],
          env: { ...process.env },
        });
      } catch {
        process.stdout.write('(agent spawn failed — falling back to no-op session)\n');
        resolve('');
        return;
      }

      // Send the context prompt as the initial message to the agent
      if (agentProcess.stdin) {
        agentProcess.stdin.write(contextPrompt + '\n');
      }

      // Enable raw mode to detect Escape keypress (\x1b)
      let rawModeEnabled = false;
      const handleKeypress = (data: Buffer): void => {
        // ESC character is \x1b (byte 27)
        if (data[0] === 0x1b) {
          cleanup();
          agentProcess.kill('SIGTERM');
          resolve('');
        }
      };

      const enableRawMode = (): void => {
        if (process.stdin.isTTY && !rawModeEnabled) {
          try {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('data', handleKeypress);
            rawModeEnabled = true;
          } catch {
            // raw mode not available in this environment — ignore
          }
        }
      };

      const cleanup = (): void => {
        if (rawModeEnabled) {
          try {
            process.stdin.removeListener('data', handleKeypress);
            process.stdin.setRawMode(false);
            process.stdin.pause();
          } catch {
            // ignore cleanup errors
          }
          rawModeEnabled = false;
        }
        // Reconnect stdin to the agent process after cleanup
        if (agentProcess.stdin) {
          agentProcess.stdin.end();
        }
      };

      enableRawMode();

      agentProcess.on('close', (_code: number | null) => {
        cleanup();
        resolve('');
      });

      agentProcess.on('error', (_err: Error) => {
        cleanup();
        resolve('');
      });
    });
  };
}

// ---------------------------------------------------------------------------
// Interactive discuss session
// ---------------------------------------------------------------------------

/**
 * Runs an interactive discuss session for a failed story by spawning an AI
 * agent subprocess (default: `claude` CLI).
 *
 * The agent receives the full failure context (failure report, code diff,
 * plan section) as its initial prompt and the user can interact directly.
 * The session ends when:
 *   - The user types 'done' or 'exit'
 *   - The user presses Escape (detected via raw mode)
 *   - The agent subprocess exits
 *
 * For testing, inject a mock `spawnAgent` via options.spawnAgent. The mock
 * receives the context prompt string and returns a Promise<string> (guidance).
 *
 * @param context - The discuss context to present to the agent
 * @param options - Optional configuration (injectable spawnAgent for testing)
 * @returns The collected guidance from the session
 */
export async function runDiscussSession(
  context: DiscussContext,
  options?: DiscussSessionOptions,
): Promise<DiscussResult> {
  const contextPrompt = buildContextPrompt(context);

  // Use the injected spawner if provided, otherwise use the default claude spawner
  const spawner: AgentSpawner = options?.spawnAgent ?? createDefaultSpawner();

  let guidance = '';
  try {
    guidance = await spawner(contextPrompt);
  } catch {
    // Spawner errors are non-fatal — session ends with empty guidance
    guidance = '';
  }

  const trimmedGuidance = guidance.trim();

  process.stdout.write('\n');
  if (trimmedGuidance) {
    process.stdout.write('[Guidance recorded]\n');
    process.stdout.write(`${trimmedGuidance}\n`);
  } else {
    process.stdout.write('[Discuss session ended]\n');
  }
  process.stdout.write('\n');

  // Persist guidance to disk so the Builder can incorporate it on the next run.
  // Saved to guidance/guidance-<storyId>.md (or <guidanceDir>/guidance-<storyId>.md if overridden).
  const guidancePath = saveGuidance(
    context.storyId,
    {
      failureContext: context.failureReport,
      userInstructions: trimmedGuidance,
      approach: '',
    },
    options?.guidanceDir ?? 'guidance',
  );
  process.stdout.write(`[Guidance saved to ${guidancePath}]\n`);

  return { storyId: context.storyId, guidance: trimmedGuidance };
}
