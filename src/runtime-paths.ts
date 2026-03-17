import * as path from 'path';

export const RALPH_RUNTIME_DIRNAME = '.ralph-teams';

export function getRalphRuntimeDir(projectRoot: string): string {
  return path.join(projectRoot, RALPH_RUNTIME_DIRNAME);
}

export function getRalphProgressPath(projectRoot: string): string {
  return path.join(getRalphRuntimeDir(projectRoot), 'progress.txt');
}

export function getRalphPlansDir(projectRoot: string): string {
  return path.join(getRalphRuntimeDir(projectRoot), 'plans');
}

export function getRalphLogsDir(projectRoot: string): string {
  return path.join(getRalphRuntimeDir(projectRoot), 'logs');
}

export function getRalphWorktreesDir(projectRoot: string): string {
  return path.join(getRalphRuntimeDir(projectRoot), '.worktrees');
}

export function getRalphStatePath(projectRoot: string): string {
  return path.join(getRalphRuntimeDir(projectRoot), 'ralph-state.json');
}
