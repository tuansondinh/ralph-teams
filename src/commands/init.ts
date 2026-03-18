import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import chalk from 'chalk';
import { setupCommand } from './setup';

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

export function buildInitPrompt(prdExample: string, outputPath: string): string {
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
    '### Phase 2: Design & Dependency Discussion',
    'Before generating any epics, you MUST discuss these topics with the user:',
    '',
    '**Design Questions:**',
    '- Identify 2-4 open architectural or implementation questions that affect how the work should be structured.',
    '- Present them to the user and discuss before moving on.',
    '- Examples: "Should X be a separate service?", "Do you want server-side or client-side rendering for Y?", "Should we use an existing library for Z or build custom?"',
    '',
    '**Epic Ordering & Dependencies:**',
    '- Propose how you would break the work into epics (just titles and one-line descriptions at this stage).',
    '- For each epic, explain what it depends on and why.',
    '- Present the dependency graph explicitly, e.g.:',
    '  "EPIC-001 (no deps) -> EPIC-002 (needs EPIC-001) -> EPIC-003 (needs EPIC-002)"',
    '  "EPIC-001 (no deps) -> EPIC-004 (needs EPIC-001, can run parallel with EPIC-002)"',
    '- Ask: "Does this ordering make sense? Would you change any dependencies?"',
    '- Do NOT proceed until the user confirms the dependency structure.',
    '',
    '### Phase 3: PRD Structure Review',
    '- Present the full epic structure: epic titles, story titles (no full descriptions yet), and dependency graph.',
    '- Each epic should have 2-5 stories. Err on the side of fewer, larger stories.',
    '- A story should represent a meaningful, testable increment — NOT a single function, config change, or file edit.',
    '- Bad example: "Add migration for users table" (too granular)',
    '- Good example: "User data model, API endpoints, and basic CRUD" (meaningful chunk)',
    '- If the user thinks stories are too granular, consolidate aggressively.',
    '- Only proceed to generation once the user approves.',
    '',
    '### Phase 4: Generation',
    '- Generate the full prd.json and write it.',
    '',
    '### Phase 5: Planning Handoff',
    '- After writing the PRD, ask the user whether they want to plan the implementation now or skip for later.',
    '- If they want to plan now, continue in the same session and discuss the implementation plan with the user.',
    '- Planning must be collaborative: discuss the approach with the user and ask follow-up questions whenever scope, architecture, sequencing, ownership, or verification is ambiguous.',
    '- Do not jump straight to writing plans if important implementation details are unclear. Resolve ambiguity through discussion first.',
    '- For each epic the user chooses to plan, write .ralph-teams/plans/plan-EPIC-xxx.md and update that epic in the PRD to set planned=true.',
    '- If the user only wants to plan some epics now, plan those and leave the others planned=false.',
    '- If they want to skip, end cleanly after confirming the PRD is written.',
    '- Do NOT tell the user to run `ralph-teams plan`, `./ralph.sh --plan`, or any other command at this point.',
    '- Do NOT ask for permission to "kick off" planning as a separate command. If the user wants planning, you take over planning immediately in this same conversation.',
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
    '- Set all new epic planned values to false.',
    '- Set all new story passes values to false.',
    '- Set all new story failureReason values to null.',
    '- dependsOn MUST be set for every epic. Use [] for epics with no dependencies.',
    '- The dependsOn values must exactly match the dependency graph agreed upon in Phase 2.',
    '- If an epic can run in parallel with others (no real dependency), its dependsOn should be [] or only include true prerequisites.',
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

  if (backend === 'codex') {
    const codexResult = spawnSync('command', ['-v', 'codex'], { shell: true, stdio: 'ignore' });
    if (codexResult.status !== 0) {
      console.error(chalk.red('Error: codex CLI is not installed or not in PATH.'));
      process.exit(1);
    }
    return;
  }

  if (backend === 'opencode') {
    const opencodeResult = spawnSync('command', ['-v', 'opencode'], { shell: true, stdio: 'ignore' });
    if (opencodeResult.status !== 0) {
      console.error(chalk.red('Error: opencode CLI is not installed or not in PATH.'));
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
  console.log(chalk.dim(`The agent will discuss requirements with you and write ${outputPath}`));
  console.log(chalk.dim('The agent will discuss design decisions and dependencies before generating.\n'));

  const { configPath, created } = await setupCommand({
    backend,
    ifMissingOnly: true,
  });
  if (created) {
    console.log(chalk.dim(`Configured ${configPath}.\n`));
  } else {
    console.log(chalk.dim(`Using existing ${configPath}.\n`));
  }
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
  } else if (backend === 'codex') {
    child = spawn('codex', ['-a', 'never', '-s', 'workspace-write', prompt], {
      stdio: 'inherit',
    });
  } else if (backend === 'opencode') {
    child = spawn('opencode', ['run', prompt], {
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
