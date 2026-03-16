/**
 * dashboard/screen.ts — Blessed screen and widget setup for the TUI dashboard.
 *
 * Creates a blessed screen with:
 *   - Header box: top 3 lines (project name, wave, elapsed time, cost)
 *   - Content box: rows 3 to -2 (scrollable, shared by all views)
 *   - Footer box: bottom 1 line (key bindings, changes per view mode)
 *
 * View modes:
 *   - 'dashboard': epic list with activity
 *   - 'logs': raw log output from ralph
 *   - 'epic-detail': detailed story/log view for one epic
 */

import * as blessed from 'blessed';
import { DashboardState } from './types';
import {
  renderHeader,
  renderEpicList,
  renderFooter,
  renderRawLogView,
  renderEpicDetailContent,
} from './renderer';
import { findLatestEpicLog, readLogTail } from './activity-parser';
import { computeRunSummary, renderSummaryView } from './views/summary-view';

export interface DashboardScreen {
  screen: blessed.Widgets.Screen;
  headerBox: blessed.Widgets.BoxElement;
  epicListBox: blessed.Widgets.BoxElement;
  footerBox: blessed.Widgets.BoxElement;
  /** Update all widgets with new state and re-render. */
  update(state: DashboardState): void;
  /** Destroy the screen and restore terminal. */
  destroy(): void;
}

/**
 * Creates and returns the blessed TUI screen with all widgets.
 * Minimum supported terminal size: 80x24.
 *
 * @param onExit - Callback when user presses q/Escape/C-c (from dashboard view)
 * @param logsDir - Directory containing epic log files (for epic-detail log tail)
 */
export function createDashboardScreen(
  onExit: () => void,
  logsDir: string = '',
): DashboardScreen {
  // Mutable view state — owned by screen, not the poller
  let currentState: DashboardState | null = null;
  let awaitingEpicNumber = false;
  /** Tracks whether we have already auto-transitioned to the summary view (one-time). */
  let summaryShown = false;

  const screen = blessed.screen({
    smartCSR: true,
    title: 'Ralph Teams',
    fullUnicode: true,
    dockBorders: false,
  });

  // Header: top 3 rows
  const headerBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: false,
    style: {
      fg: 'white',
      bg: 'blue',
      bold: true,
    },
    content: 'Ralph Teams',
  });

  // Content area: between header and footer (shared by all view modes)
  const epicListBox = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: '100%',
    height: '100%-4',
    tags: false,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    style: {
      fg: 'white',
      bg: 'black',
    },
    scrollbar: {
      ch: '|',
      style: {
        fg: 'white',
      },
    },
    content: '  Loading...',
  });

  // Footer: last row
  const footerBox = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: false,
    style: {
      fg: 'black',
      bg: 'white',
    },
    content: renderFooter('dashboard', false),
  });

  /**
   * Re-renders the content box and footer based on current view mode.
   * Called after any state or view mode change.
   */
  function render(): void {
    if (!currentState) {
      screen.render();
      return;
    }

    const state = currentState;

    // Update footer based on view mode and awaitingEpicNumber
    footerBox.setContent(renderFooter(state.viewMode, awaitingEpicNumber));

    switch (state.viewMode) {
      case 'logs':
        epicListBox.setContent(renderRawLogView(state.rawLogLines));
        // Auto-scroll to bottom for log view
        epicListBox.setScrollPerc(100);
        break;

      case 'epic-detail': {
        const epicId = state.selectedEpicId;
        let logTail = '';
        if (epicId && logsDir) {
          try {
            const logFile = findLatestEpicLog(logsDir, epicId);
            if (logFile) {
              logTail = readLogTail(logFile, 15);
            }
          } catch {
            // silently ignore
          }
        }
        epicListBox.setContent(renderEpicDetailContent(state, epicId, logTail));
        break;
      }

      case 'summary': {
        const summary = computeRunSummary(state);
        epicListBox.setContent(renderSummaryView(summary));
        break;
      }

      default:
        epicListBox.setContent(renderEpicList(state));
        break;
    }

    screen.render();
  }

  // ─── Key bindings ──────────────────────────────────────────────────────────

  // Ctrl-C always exits (does not toggle; graceful shutdown)
  screen.key(['C-c'], () => {
    onExit();
  });

  // 'q' / Escape: exit from dashboard/summary, or return to dashboard from other views
  screen.key(['q', 'Q', 'escape'], () => {
    if (!currentState) {
      onExit();
      return;
    }
    if (currentState.viewMode === 'dashboard' || currentState.viewMode === 'summary') {
      onExit();
    } else {
      currentState = { ...currentState, viewMode: 'dashboard', selectedEpicId: null };
      awaitingEpicNumber = false;
      render();
    }
  });

  // 'd': toggle between dashboard and log view
  screen.key(['d', 'D'], () => {
    if (!currentState) return;
    awaitingEpicNumber = false;
    currentState = {
      ...currentState,
      viewMode: currentState.viewMode === 'dashboard' ? 'logs' : 'dashboard',
      selectedEpicId: currentState.viewMode === 'logs' ? currentState.selectedEpicId : null,
    };
    render();
  });

  // 'e': enter epic selection mode (next digit selects the epic)
  screen.key(['e', 'E'], () => {
    if (!currentState) return;
    awaitingEpicNumber = true;
    footerBox.setContent(renderFooter(currentState.viewMode, true));
    screen.render();
  });

  // Digit keys: select epic if awaitingEpicNumber
  screen.key(['1', '2', '3', '4', '5', '6', '7', '8', '9'], (ch: string) => {
    if (!currentState) return;
    if (awaitingEpicNumber) {
      const epicIndex = parseInt(ch, 10) - 1;
      if (epicIndex >= 0 && epicIndex < currentState.epics.length) {
        currentState = {
          ...currentState,
          viewMode: 'epic-detail',
          selectedEpicId: currentState.epics[epicIndex].id,
        };
      }
      awaitingEpicNumber = false;
      render();
    }
  });

  // Arrow / vim scroll keys
  screen.key(['up', 'k'], () => {
    epicListBox.scroll(-1);
    screen.render();
  });

  screen.key(['down', 'j'], () => {
    epicListBox.scroll(1);
    screen.render();
  });

  // Manual refresh
  screen.key(['r', 'R'], () => {
    render();
  });

  // Give focus to the scrollable content area
  epicListBox.focus();

  screen.render();

  function update(state: DashboardState): void {
    const headerLines = renderHeader(state);
    headerBox.setContent(headerLines.join('\n'));

    // Preserve view mode across poller updates (poller always sends viewMode: 'dashboard')
    if (currentState) {
      currentState = {
        ...state,
        viewMode: currentState.viewMode,
        selectedEpicId: currentState.selectedEpicId,
      };
    } else {
      currentState = state;
    }

    // Auto-transition to summary view once the run is complete (one-time only)
    if (
      currentState.runComplete &&
      !summaryShown &&
      currentState.viewMode === 'dashboard'
    ) {
      summaryShown = true;
      currentState = { ...currentState, viewMode: 'summary' };
    }

    render();
  }

  function destroy(): void {
    try {
      screen.destroy();
    } catch {
      // ignore errors during cleanup
    }
  }

  return { screen, headerBox, epicListBox, footerBox, update, destroy };
}
