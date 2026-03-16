import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';

export interface UserStory {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: number;
  passes: boolean;
  failureReason?: string | null;
}

export interface Epic {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'completed' | 'partial' | 'failed' | 'merge-failed';
  planned?: boolean;
  dependsOn?: string[];
  userStories: UserStory[];
}

export interface Prd {
  project?: string;
  branchName?: string;
  description?: string;
  epics: Epic[];
}

export function loadPrd(prdPath: string): { prd: Prd; resolved: string } {
  const resolved = path.resolve(prdPath);
  if (!fs.existsSync(resolved)) {
    console.error(chalk.red(`Error: prd.json not found at ${resolved}`));
    process.exit(1);
    throw new Error('unreachable');
  }
  try {
    const prd = JSON.parse(fs.readFileSync(resolved, 'utf-8')) as Prd;
    for (const epic of prd.epics ?? []) {
      if (epic.planned === undefined) {
        epic.planned = false;
      }
      for (const story of epic.userStories ?? []) {
        if (story.failureReason === undefined) {
          story.failureReason = null;
        }
      }
    }
    return { prd, resolved };
  } catch {
    console.error(chalk.red(`Error: failed to parse ${resolved}`));
    process.exit(1);
    throw new Error('unreachable');
  }
}

export function savePrd(resolved: string, prd: Prd): void {
  fs.writeFileSync(resolved, JSON.stringify(prd, null, 2));
}

export function epicStatusColor(status: string): string {
  switch (status) {
    case 'completed': return chalk.green(status);
    case 'failed':    return chalk.red(status);
    case 'merge-failed': return chalk.red(status);
    case 'partial':   return chalk.yellow(status);
    default:          return chalk.yellow(status);
  }
}

export function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function askMultiline(rl: readline.Interface, prompt: string): Promise<string[]> {
  console.log(chalk.dim(`${prompt} (enter each on a new line, empty line to finish):`));
  const lines: string[] = [];
  while (true) {
    const line = await ask(rl, '  > ');
    if (line === '') break;
    lines.push(line);
  }
  return lines;
}
