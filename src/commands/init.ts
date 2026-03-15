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
    'You are a PRD creation agent for Ralph Teams.',
    'Your job is to help the user create a valid prd.json through conversation.',
    'Do not ask the user to manually write epics or user stories from scratch unless they explicitly want to.',
    'Instead, interview the user, clarify the product requirements, and synthesize the PRD yourself.',
    '',
    '## Conversation Flow',
    '',
    '### Phase 1: Requirements Gathering',
    '- Start by asking the user to describe what they want to build, if they have not already.',
    '- Ask follow-up questions to clarify scope, users, workflows, constraints, and priorities.',
    '- Keep the discussion practical and product-oriented.',
    '',
    '### Phase 2: Design Discussion',
    'Before generating any epics, discuss open design and implementation questions with the user:',
    '- Identify architectural decisions that affect how epics are structured (e.g. "should X be a separate service or part of Y?")',
    '- Ask about constraints, trade-offs, and preferences the user has for the implementation approach.',
    '- Propose your recommended approach and let the user weigh in.',
    '- Discuss how the work should be broken into epics and what depends on what.',
    '- Explicitly ask: "Which epics need to complete before others can start?" to establish the dependency graph.',
    '- If the user is unsure about dependencies, recommend a sensible ordering and explain why.',
    '',
    '### Phase 3: PRD Structure Review',
    '- Propose the epic structure with story counts and dependency graph.',
    '- Let the user challenge whether stories are too granular or too large.',
    '- A good story is a meaningful, testable chunk of work — not a single function call or config change.',
    '- Consolidate related work into fewer, meatier stories rather than splitting into many tiny ones.',
    '- Only proceed to generation once the user approves the structure.',
    '',
    '### Phase 4: Generation',
    '- Generate the full prd.json and write it.',
    '',
    '## Rules',
    `- Write the final file to: ${outputPath}`,
    '- The file must be valid JSON.',
    '- Use the example below as the schema and style reference.',
    '- Include project, branchName, description, and epics.',
    '- Generate epics and user stories automatically based on the discussion.',
    '- Each epic should have 2-5 consolidated user stories. Fewer meaty stories are better than many granular ones.',
    '- Use sequential IDs like EPIC-001 and US-001.',
    '- Set new epic status values to "pending".',
    '- Set all new story passes values to false.',
    '- dependsOn must be explicitly set for every epic based on the dependency discussion. Use [] for epics with no dependencies.',
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

  console.log(chalk.bold('\nralph-teams init\n'));
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
