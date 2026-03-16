/**
 * dashboard/index.ts — Main dashboard entry point.
 *
 * Exports startDashboard() which wires together the blessed screen,
 * file poller, and renderer into a live TUI dashboard.
 */

import * as path from 'path';
import { DashboardOptions, DashboardState, PostRunCallbacks } from './types';
import { createDashboardScreen, DashboardScreen } from './screen';
import { createPoller } from './poller';

/** Handle returned by startDashboard for cleanup. */
export interface Dashboard {
  /** Stop polling and destroy the screen. */
  stop(): void;
}

/**
 * Starts the TUI dashboard.
 *
 * Creates the blessed screen, starts file polling, and wires updates to
 * the screen renderer. Returns a handle to stop and clean up.
 *
 * @param options - Dashboard configuration (paths, poll interval)
 * @param postRunCallbacks - Optional callbacks for the post-run interactive menu
 * @returns Dashboard handle with a stop() method
 */
export function startDashboard(options: DashboardOptions, postRunCallbacks?: PostRunCallbacks): Dashboard {
  let dashScreen: DashboardScreen | null = null;

  function onExit(): void {
    poller.stop();
    if (dashScreen) {
      dashScreen.destroy();
      dashScreen = null;
    }
    process.exit(0);
  }

  dashScreen = createDashboardScreen(onExit, options.logsDir, postRunCallbacks);

  const poller = createPoller(options, (state: DashboardState) => {
    if (dashScreen) {
      dashScreen.update(state);
    }
  });

  // Handle SIGINT (Ctrl-C) for terminal cleanup
  process.on('SIGINT', () => {
    onExit();
  });

  poller.start();

  return {
    stop() {
      poller.stop();
      if (dashScreen) {
        dashScreen.destroy();
        dashScreen = null;
      }
    },
  };
}

/**
 * Resolves default DashboardOptions from a prd.json path and working directory.
 *
 * @param prdPath - Resolved path to prd.json
 * @param cwd - Working directory (for resolving relative paths)
 * @param pollIntervalMs - Poll interval in ms (default: 1500)
 */
export function resolveDashboardOptions(
  prdPath: string,
  cwd: string,
  pollIntervalMs: number = 1500,
): DashboardOptions {
  return {
    prdPath,
    statsPath: path.join(cwd, 'ralph-run-stats.json'),
    logsDir: path.join(cwd, 'logs'),
    progressPath: path.join(cwd, 'progress.txt'),
    pollIntervalMs,
  };
}
