/**
 * discuss.ts — Discuss agent for failed user stories.
 *
 * Gathers context (failure report, code diff, plan section) for a failed story
 * and runs an interactive readline session so the user can provide guidance
 * for the next implementation attempt.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { spawnSync } from 'child_process';

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
// Interactive discuss session
// ---------------------------------------------------------------------------

/**
 * Runs an interactive readline session for discussing a failed story.
 *
 * Prints the gathered context (failure report, diff, plan section) and
 * collects user messages as guidance. The session ends when the user types
 * 'done', 'exit', or an empty line.
 *
 * @param context - The discuss context to present
 * @param rl - Optional readline interface (injectable for testing)
 * @returns The collected guidance from the session
 */
export async function runDiscussSession(
  context: DiscussContext,
  rl?: readline.Interface,
): Promise<DiscussResult> {
  const sep = '─'.repeat(72);

  // Print context to stdout
  process.stdout.write('\n');
  process.stdout.write(`${sep}\n`);
  process.stdout.write(`Discussing: ${context.storyId} (${context.epicId})\n`);
  process.stdout.write(`${sep}\n`);

  process.stdout.write('\n[Failure Report]\n');
  process.stdout.write(`${sep}\n`);
  process.stdout.write(`${context.failureReport}\n`);

  process.stdout.write(`\n[Code Changes (stat)]\n`);
  process.stdout.write(`${sep}\n`);
  process.stdout.write(`${context.codeDiff}\n`);

  process.stdout.write(`\n[Plan Section]\n`);
  process.stdout.write(`${sep}\n`);
  process.stdout.write(`${context.planSection}\n`);

  process.stdout.write(`\n${sep}\n`);
  process.stdout.write('Discuss what went wrong and provide guidance for the next attempt.\n');
  process.stdout.write("Type 'done' or press Enter on an empty line to finish.\n");
  process.stdout.write(`${sep}\n\n`);

  // Set up readline if not provided
  const ownRl = rl === undefined;
  const readlineInterface = rl ?? readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const guidanceLines: string[] = [];

  try {
    await new Promise<void>((resolve) => {
      const askNext = (): void => {
        readlineInterface.question('> ', (answer: string) => {
          const trimmed = answer.trim();

          if (trimmed === '' || trimmed === 'done' || trimmed === 'exit') {
            resolve();
            return;
          }

          guidanceLines.push(trimmed);
          askNext();
        });
      };

      askNext();

      // Also handle close event (Ctrl-D / Escape in terminal)
      readlineInterface.once('close', () => {
        resolve();
      });
    });
  } finally {
    if (ownRl) {
      readlineInterface.close();
    }
  }

  const guidance = guidanceLines.join('\n');

  process.stdout.write('\n');
  if (guidance) {
    process.stdout.write('[Guidance recorded]\n');
    process.stdout.write(`${guidance}\n`);
  } else {
    process.stdout.write('[No guidance provided — session ended]\n');
  }
  process.stdout.write('\n');

  return { storyId: context.storyId, guidance };
}
