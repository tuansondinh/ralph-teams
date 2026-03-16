import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

function findCircularDeps(epics: Array<{ id: string; dependsOn?: string[] }>): string[] {
  const depMap = new Map<string, string[]>();
  for (const epic of epics) {
    depMap.set(epic.id, epic.dependsOn ?? []);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycleErrors: string[] = [];

  function dfs(id: string, stack: string[]): void {
    if (inStack.has(id)) {
      const cycleStart = stack.indexOf(id);
      const cycle = stack.slice(cycleStart).concat(id);
      cycleErrors.push(`Circular dependency detected involving: ${cycle.join(', ')}`);
      return;
    }
    if (visited.has(id)) return;

    visited.add(id);
    inStack.add(id);
    stack.push(id);

    for (const dep of depMap.get(id) ?? []) {
      if (depMap.has(dep)) {
        dfs(dep, stack);
      }
    }

    stack.pop();
    inStack.delete(id);
  }

  for (const epic of epics) {
    if (!visited.has(epic.id)) {
      dfs(epic.id, []);
    }
  }

  return cycleErrors;
}

export function validateCommand(prdPath: string): void {
  const resolved = path.resolve(prdPath);
  const errors: string[] = [];

  if (!fs.existsSync(resolved)) {
    console.error(chalk.red(`Error: prd.json not found at ${resolved}`));
    process.exit(1);
  }

  let prd: unknown;
  try {
    prd = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch {
    console.error(chalk.red(`Error: failed to parse ${resolved} as JSON`));
    process.exit(1);
  }

  if (typeof prd !== 'object' || prd === null || Array.isArray(prd)) {
    errors.push('Root value must be an object');
    printResults(errors);
    return;
  }

  const root = prd as Record<string, unknown>;

  if (!Array.isArray(root.epics)) {
    errors.push('Missing required field: epics (must be an array)');
    printResults(errors);
    return;
  }

  const epics = root.epics as unknown[];
  if (epics.length === 0) {
    errors.push('Missing required field: epics (must be a non-empty array)');
  }

  if (typeof root.project !== 'string' || root.project.trim() === '') {
    errors.push('Missing required field: project (must be a non-empty string)');
  }

  const epicIds = new Set<string>();
  const duplicateEpicIds = new Set<string>();
  const allStoryIds = new Set<string>();
  const duplicateStoryIds = new Set<string>();
  const validStatuses = new Set(['pending', 'completed', 'partial', 'failed', 'merge-failed']);

  const validEpics: Array<{ id: string; dependsOn?: string[] }> = [];

  for (let i = 0; i < epics.length; i++) {
    const epic = epics[i];
    if (typeof epic !== 'object' || epic === null || Array.isArray(epic)) {
      errors.push(`epics[${i}] must be an object`);
      continue;
    }
    const e = epic as Record<string, unknown>;

    // Required fields
    if (typeof e.id !== 'string') {
      errors.push(`epics[${i}] missing required string field: id`);
    } else {
      if (epicIds.has(e.id)) {
        duplicateEpicIds.add(e.id);
      } else {
        epicIds.add(e.id);
      }
    }

    if (typeof e.title !== 'string') {
      errors.push(`epics[${i}] (${typeof e.id === 'string' ? e.id : i}) missing required string field: title`);
    }

    if (typeof e.status !== 'string') {
      errors.push(`epics[${i}] (${typeof e.id === 'string' ? e.id : i}) missing required string field: status`);
    } else if (!validStatuses.has(e.status)) {
      errors.push(`epics[${i}] (${e.id}) invalid status "${e.status}" — must be one of: pending, completed, partial, failed, merge-failed`);
    }

    if (!Array.isArray(e.userStories)) {
      errors.push(`epics[${i}] (${typeof e.id === 'string' ? e.id : i}) missing required field: userStories (must be an array)`);
    } else {
      const stories = e.userStories as unknown[];
      if (stories.length === 0) {
        errors.push(`epics[${i}] (${typeof e.id === 'string' ? e.id : i}) userStories must be a non-empty array`);
      }
      for (let j = 0; j < stories.length; j++) {
        const story = stories[j];
        if (typeof story !== 'object' || story === null || Array.isArray(story)) {
          errors.push(`epics[${i}].userStories[${j}] must be an object`);
          continue;
        }
        const s = story as Record<string, unknown>;

        if (typeof s.id !== 'string') {
          errors.push(`epics[${i}].userStories[${j}] missing required string field: id`);
        } else {
          if (allStoryIds.has(s.id)) {
            duplicateStoryIds.add(s.id);
          } else {
            allStoryIds.add(s.id);
          }
        }

        if (typeof s.title !== 'string') {
          errors.push(`epics[${i}].userStories[${j}] (${typeof s.id === 'string' ? s.id : j}) missing required string field: title`);
        }

        if (typeof s.passes !== 'boolean') {
          errors.push(`epics[${i}].userStories[${j}] (${typeof s.id === 'string' ? s.id : j}) missing required boolean field: passes`);
        }
      }
    }

    if (e.dependsOn !== undefined) {
      if (!Array.isArray(e.dependsOn)) {
        errors.push(`epics[${i}] (${typeof e.id === 'string' ? e.id : i}) dependsOn must be an array`);
      } else {
        for (let j = 0; j < e.dependsOn.length; j++) {
          if (typeof e.dependsOn[j] !== 'string') {
            errors.push(`epics[${i}] (${typeof e.id === 'string' ? e.id : i}) dependsOn[${j}] must be a string`);
          }
        }
      }
    }

    // Collect valid epics for dependency checks
    if (typeof e.id === 'string') {
      const dependsOn = Array.isArray(e.dependsOn)
        ? (e.dependsOn as unknown[]).filter((d): d is string => typeof d === 'string')
        : undefined;
      validEpics.push({ id: e.id, dependsOn });
    }
  }

  // Duplicate ID checks
  for (const id of duplicateEpicIds) {
    errors.push(`Duplicate epic ID: ${id}`);
  }
  for (const id of duplicateStoryIds) {
    errors.push(`Duplicate story ID: ${id}`);
  }

  // DependsOn reference checks
  for (const epic of validEpics) {
    for (const dep of epic.dependsOn ?? []) {
      if (!epicIds.has(dep)) {
        errors.push(`Epic ${epic.id} dependsOn unknown epic ID: ${dep}`);
      }
    }
  }

  // Circular dependency checks
  const circularErrors = findCircularDeps(validEpics);
  errors.push(...circularErrors);

  printResults(errors);
}

function printResults(errors: string[]): void {
  if (errors.length === 0) {
    console.log(chalk.green('✓ prd.json is valid'));
    process.exit(0);
  } else {
    for (const error of errors) {
      console.error(chalk.red(`✗ ${error}`));
    }
    process.exit(1);
  }
}
