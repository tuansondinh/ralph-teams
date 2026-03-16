/** Options accepted by the update-stats CLI command. */
export interface UpdateStatsOptions {
  epicId: string;
  storyId: string;
  logFile: string;
  passed: string;
  backend: string;
  startedAt?: string;
  completedAt?: string;
  storiesTotal?: string;
}

/** Injectable dependencies for testability. */
export interface UpdateStatsDeps {
  log: (msg: string) => void;
}

const defaultDeps: UpdateStatsDeps = {
  log: (_msg: string) => {},
};

/**
 * Implements the `ralph-teams update-stats` command.
 *
 * Statistics are temporarily disabled. Keep this command as a silent no-op so
 * existing shell orchestration can continue to call it safely.
 */
export function updateStatsCommand(
  _options: UpdateStatsOptions,
  _deps: UpdateStatsDeps = defaultDeps,
): void {}
