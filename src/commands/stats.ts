/** Injectable dependencies for testability. */
export interface StatsDeps {
  log: (msg: string) => void;
}

const defaultDeps: StatsDeps = {
  log: (msg: string) => console.log(msg),
};

/**
 * Implements the `ralph-teams stats` command.
 *
 * Statistics are temporarily disabled while the telemetry model is being
 * corrected. The command remains available so users get a clear message
 * instead of stale or misleading output.
 */
export function statsCommand(_statsPath: string, deps: StatsDeps = defaultDeps): void {
  deps.log('Statistics are temporarily disabled.');
}
