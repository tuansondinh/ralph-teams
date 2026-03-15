import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import chalk from 'chalk';

interface InitOptions {
  backend?: string;
}

function findPrdExample(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../prd.json.example'),
    path.resolve(__dirname, '../prd.json.example'),
    path.resolve(process.cwd(), 'prd.json.example'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildInitPrompt(prdExample: string, outputPath: string): string {
  return [
    'You are a PRD creation agent for Ralph Team Agents.',
    'Your job is to help the user create a valid prd.json through conversation.',
    'Do not ask the user to manually write epics or user stories from scratch unless they explicitly want to.',
    'Instead, interview the user, clarify the product requirements, and synthesize the PRD yourself.',
    '',
    'Rules:',
    '- Start by asking the user to describe what they want to build, if they have not already.',
    '- Ask follow-up questions as needed to clarify scope, users, workflows, constraints, and priorities.',
    '- Keep the discussion practical and product-oriented.',
    '- When requirements are clear enough, generate the full prd.json yourself.',
    `- Write the final file to: ${outputPath}`,
    '- The file must be valid JSON.',
    '- Use the example below as the schema and style reference.',
    '- Include project, branchName, description, and epics.',
    '- Generate epics and user stories automatically based on the discussion.',
    '- Use sequential IDs like EPIC-001 and US-001.',
    '- Set new epic status values to "pending".',
    '- Set all new story passes values to false.',
    '- Before writing the final file, summarize the proposed PRD structure and let the user correct anything important.',
    '- Only finish once the PRD has been written, or the user cancels.',
    '',
    'Schema/style reference:',
    prdExample,
  ].join('\n');
}

function ensureBackendAvailable(backend: string): void {
  if (backend === 'claude') {
    const result = spawnSync('command', ['-v', 'claude'], { shell: true, stdio: 'ignore' });
    if (result.status !== 0) {
      console.error(chalk.red('Error: claude CLI is not installed or not in PATH.'));
      process.exit(1);
    }
    return;
  }

  if (backend === 'copilot') {
    const ghResult = spawnSync('command', ['-v', 'gh'], { shell: true, stdio: 'ignore' });
    if (ghResult.status !== 0) {
      console.error(chalk.red('Error: gh CLI is not installed or not in PATH.'));
      process.exit(1);
    }

    const copilotResult = spawnSync('gh', ['copilot', '--', '--version'], {
      stdio: 'ignore',
    });
    if (copilotResult.status !== 0) {
      console.error(chalk.red('Error: GitHub Copilot CLI is not available.'));
      process.exit(1);
    }
    return;
  }

  console.error(chalk.red(`Error: unsupported backend "${backend}"`));
  process.exit(1);
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const backend = options.backend || 'claude';
  const examplePath = findPrdExample();

  if (!examplePath) {
    console.error(chalk.red('Error: prd.json.example not found'));
    process.exit(1);
  }

  const prdExample = fs.readFileSync(examplePath, 'utf-8');
  const outputPath = path.resolve('./prd.json');
  const prompt = buildInitPrompt(prdExample, outputPath);

  console.log(chalk.bold('\nralph-team-agents init\n'));
  console.log(chalk.dim(`Starting interactive PRD creator with ${backend}...`));
  console.log(chalk.dim(`The agent will discuss requirements with you and write ${outputPath}\n`));

  ensureBackendAvailable(backend);

  let child;
  if (backend === 'claude') {
    child = spawn('claude', ['--dangerously-skip-permissions', prompt], {
      stdio: 'inherit',
    });
  } else if (backend === 'copilot') {
    child = spawn('gh', ['copilot', '--', '--allow-all', '-i', prompt], {
      stdio: 'inherit',
    });
  } else {
    console.error(chalk.red(`Error: unsupported backend "${backend}"`));
    process.exit(1);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${backend} exited with code ${code}`));
      }
    });
    child.on('error', reject);
  }).catch((error) => {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  });

  if (fs.existsSync(outputPath)) {
    console.log(chalk.green(`\nCreated ${outputPath}\n`));
  } else {
    console.log(chalk.yellow(`\nNo prd.json was created at ${outputPath}\n`));
  }
}
