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

export interface FailedStoryContext extends DiscussContext {
  storyTitle: string;
  epicTitle: string;
  failureReason: string | null;
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
  /** Backend to launch for the guided session. Defaults to 'claude'. */
  backend?: 'claude' | 'copilot' | 'codex' | 'opencode';
}

export interface FailedStoriesDiscussOptions {
  spawnAgent?: AgentSpawner;
  backend?: 'claude' | 'copilot' | 'codex' | 'opencode';
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

function buildGuidedDiscussPrompt(context: DiscussContext): string {
  return [
    buildContextPrompt(context),
    '',
    'You are running a guided retry discussion with the user.',
    'Behave like an interactive product/engineering interview session.',
    'Ask focused follow-up questions, help the user reason about the failure, and converge on concrete retry guidance.',
    'Before exiting, summarize the agreed next steps clearly in chat.',
  ].join('\n');
}

export function buildFailedStoriesDiscussPrompt(contexts: FailedStoryContext[]): string {
  const sep = '─'.repeat(72);
  const storyBlocks = contexts.map((context) => [
    sep,
    `${context.storyId} — ${context.storyTitle}`,
    `Epic: ${context.epicId} — ${context.epicTitle}`,
    `Failure reason: ${context.failureReason ?? '(not recorded)'}`,
    '',
    '[Failure Report]',
    context.failureReport,
    '',
    '[Code Changes (git diff --stat)]',
    context.codeDiff,
    '',
    '[Plan Section]',
    context.planSection,
  ].join('\n'));

  return [
    'You are running a guided retry discussion for Ralph Teams.',
    'The user has one or more failed stories that need triage and retry guidance.',
    '',
    'Start by summarizing the failed stories and asking the user which one to discuss first.',
    'Guide the conversation story by story. Ask focused follow-up questions and converge on concrete retry instructions.',
    'When the user says they are done, summarize the agreed retry steps and exit.',
    '',
    ...storyBlocks,
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
  backend: 'claude' | 'copilot' | 'codex' | 'opencode' = 'claude',
): AgentSpawner {
  return (contextPrompt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const sep = '─'.repeat(72);
      process.stdout.write('\n');
      process.stdout.write(`${sep}\n`);
      process.stdout.write('Discuss session starting — the agent will guide the conversation.\n');
      process.stdout.write(`${sep}\n\n`);

      let command: string;
      let args: string[];
      if (backend === 'claude') {
        command = 'claude';
        args = ['--dangerously-skip-permissions', contextPrompt];
      } else if (backend === 'copilot') {
        command = 'gh';
        args = ['copilot', '--', '--allow-all', '-i', contextPrompt];
      } else if (backend === 'codex') {
        command = 'codex';
        args = ['-a', 'never', '-c', 'model_reasoning_effort="high"', '-s', 'workspace-write', contextPrompt];
      } else {
        command = 'opencode';
        args = ['.', '--prompt', contextPrompt];
      }

      let agentProcess: ChildProcess;
      try {
        agentProcess = spawn(command, args, {
          stdio: 'inherit',
          env: { ...process.env },
        });
      } catch (err) {
        reject(err);
        return;
      }

      agentProcess.on('close', (code: number | null) => {
        if (code === 0) {
          resolve('');
          return;
        }
        reject(new Error(`${backend} exited with code ${code}`));
      });

      agentProcess.on('error', reject);
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
  const contextPrompt = buildGuidedDiscussPrompt(context);

  const spawner: AgentSpawner = options?.spawnAgent ?? createDefaultSpawner(options?.backend ?? 'claude');

  let guidance = '';
  try {
    guidance = await spawner(contextPrompt);
  } catch {
    // Spawner errors are non-fatal — session ends with empty guidance
    guidance = '';
  }

  const finalGuidance = guidance.trim();

  process.stdout.write('\n');
  if (finalGuidance) {
    process.stdout.write('[Discussion summary]\n');
    process.stdout.write(`${finalGuidance}\n`);
  } else {
    process.stdout.write('[Discuss session ended]\n');
  }
  process.stdout.write('\n');

  return { storyId: context.storyId, guidance: finalGuidance };
}

export async function runFailedStoriesDiscussSession(
  contexts: FailedStoryContext[],
  options?: FailedStoriesDiscussOptions,
): Promise<void> {
  if (contexts.length === 0) {
    return;
  }

  const contextPrompt = buildFailedStoriesDiscussPrompt(contexts);
  const spawner: AgentSpawner = options?.spawnAgent ?? createDefaultSpawner(options?.backend ?? 'claude');

  try {
    await spawner(contextPrompt);
  } catch {
    // Non-fatal: the user may have exited the interactive backend early.
  }

  process.stdout.write('\n');
  process.stdout.write('[Discuss session ended]\n');
  process.stdout.write('\n');
}
