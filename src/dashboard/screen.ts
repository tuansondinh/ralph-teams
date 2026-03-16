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
 *   - 'summary': final run summary (shown after run completes)
 *   - 'discuss': discuss a failed story (stub for US-018)
 */

import * as blessed from 'blessed';
import { DashboardState, PostRunCallbacks } from './types';
import {
  renderHeader,
  renderEpicList,
  renderFooter,
  renderRawLogView,
  renderEpicDetailContent,
} from './renderer';
import { findLatestEpicLog, readLogTail } from './activity-parser';
import { computeRunSummary, renderSummaryView } from './views/summary-view';
import {
  DiscussContext,
  DiscussMessage,
  renderDiscussView,
} from './views/discuss-view';
import { buildDiscussContext } from './discuss-context-loader';

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
 * @param postRunCallbacks - Optional callbacks for the post-run interactive menu (summary view)
 * @param plansDir - Directory containing plan-<epicId>.md files (for discuss context)
 * @param getProgressContent - Optional getter returning the latest raw progress.txt content
 * @param worktreesDir - Base directory for git worktrees (for code diff loading)
 */
export function createDashboardScreen(
  onExit: () => void,
  logsDir: string = '',
  postRunCallbacks?: PostRunCallbacks,
  plansDir: string = '',
  getProgressContent?: () => string | null,
  worktreesDir: string = '',
): DashboardScreen {
  // Mutable view state — owned by screen, not the poller
  let currentState: DashboardState | null = null;
  let awaitingEpicNumber = false;
  /** Tracks whether we have already auto-transitioned to the summary view (one-time). */
  let summaryShown = false;
  /**
   * When in summary mode with multiple failed stories, pressing 'd' enters
   * story-selection mode. The next digit key selects a story to discuss.
   * The list of selectable story IDs is stored here.
   */
  let discussStoryIds: string[] = [];

  // ─── Discuss session state ─────────────────────────────────────────────
  /** Active discuss context (set when entering discuss view). */
  let discussContext: DiscussContext | null = null;
  /** Conversation messages for the current discuss session. */
  let discussMessages: DiscussMessage[] = [];

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

  // Footer: last row (row -2 in discuss mode to make room for input)
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

  // Input textbox: shown only in discuss mode (row -2, above the footer hint)
  const inputBox = blessed.textbox({
    parent: screen,
    bottom: 1,
    left: 0,
    width: '100%',
    height: 1,
    keys: true,
    mouse: true,
    hidden: true,
    inputOnFocus: true,
    style: {
      fg: 'white',
      bg: 'blue',
    },
  });

  /**
   * Returns true when the current state has at least one story in 'fail' state.
   * Used to decide which summary footer / menu to show.
   */
  function computeHasFailedStories(state: DashboardState): boolean {
    return state.epics.some(epic => epic.stories.some(s => s.state === 'fail'));
  }

  /**
   * Enters discuss mode for a specific story ID.
   * Loads context from plan file and progress.txt, then switches the view.
   */
  function enterDiscussMode(storyId: string): void {
    if (!currentState) return;
    const progress = getProgressContent ? getProgressContent() : null;
    const ctx = buildDiscussContext(currentState, storyId, plansDir, progress, worktreesDir);
    if (!ctx) return;

    discussContext = ctx;
    discussMessages = [];
    currentState = { ...currentState, viewMode: 'discuss' };

    // Show and focus the input box
    inputBox.show();
    inputBox.setValue('');
    // Resize content area to leave room for input row
    epicListBox.height = '100%-5'; // header(3) + input(1) + footer(1)
    render();
    inputBox.focus();
    screen.render();
  }

  /**
   * Exits discuss mode and returns to the summary view.
   * Hides the input box and restores normal content area height.
   */
  function exitDiscussMode(): void {
    discussContext = null;
    discussMessages = [];
    inputBox.hide();
    epicListBox.height = '100%-4'; // back to normal: header(3) + footer(1)
    if (currentState) {
      currentState = { ...currentState, viewMode: 'summary' };
    }
    epicListBox.focus();
    render();
  }

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
    const hasFailedStories = computeHasFailedStories(state);

    // Update footer based on view mode, awaitingEpicNumber, and hasFailedStories
    footerBox.setContent(renderFooter(state.viewMode, awaitingEpicNumber, hasFailedStories));

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
        epicListBox.setContent(renderSummaryView(summary, hasFailedStories));
        break;
      }

      case 'discuss':
        if (discussContext) {
          epicListBox.setContent(renderDiscussView(discussContext, discussMessages));
          epicListBox.setScrollPerc(100);
        } else {
          epicListBox.setContent('  (no discuss context — press Esc to return)');
        }
        break;

      default:
        epicListBox.setContent(renderEpicList(state));
        break;
    }

    screen.render();
  }

  // ─── Discuss input handler ─────────────────────────────────────────────────

  // Handle text submission from the input box (user presses Enter)
  inputBox.on('submit', (value: string) => {
    const text = (value ?? '').trim();
    inputBox.setValue('');

    if (!text) {
      // Empty submit: just refocus the input
      inputBox.focus();
      screen.render();
      return;
    }

    // 'done' ends the discuss session
    if (text.toLowerCase() === 'done') {
      exitDiscussMode();
      return;
    }

    // Add user message to conversation
    discussMessages.push({ role: 'user', text });
    render();
    // Re-focus for the next message
    inputBox.focus();
    screen.render();
  });

  // Handle Escape in the input box — exit discuss mode
  inputBox.key(['escape'], () => {
    exitDiscussMode();
  });

  // ─── Key bindings ──────────────────────────────────────────────────────────

  // Ctrl-C always exits (does not toggle; graceful shutdown)
  screen.key(['C-c'], () => {
    onExit();
  });

  // 'q' / Escape: context-sensitive quit/back
  //   - dashboard → exit
  //   - summary + story-selection active → cancel story selection, re-render summary
  //   - summary → invoke onQuit callback if set, otherwise exit
  //   - discuss → return to summary
  //   - logs, epic-detail → return to dashboard
  screen.key(['q', 'Q', 'escape'], () => {
    if (!currentState) {
      onExit();
      return;
    }

    // Cancel discuss story selection without leaving summary
    if (discussStoryIds.length > 0) {
      discussStoryIds = [];
      render();
      return;
    }

    if (currentState.viewMode === 'dashboard') {
      onExit();
    } else if (currentState.viewMode === 'summary') {
      if (postRunCallbacks) {
        postRunCallbacks.onQuit();
      } else {
        onExit();
      }
    } else if (currentState.viewMode === 'discuss') {
      exitDiscussMode();
    } else {
      currentState = { ...currentState, viewMode: 'dashboard', selectedEpicId: null };
      awaitingEpicNumber = false;
      render();
    }
  });

  // 'd': context-sensitive
  //   - summary mode with failed stories + story-selection active → select story by number
  //   - summary mode with failed stories → show numbered list of failed stories to discuss
  //   - dashboard/logs → toggle between dashboard and log view
  //   - other modes → no-op
  screen.key(['d', 'D'], () => {
    if (!currentState) return;
    if (currentState.viewMode === 'summary') {
      if (computeHasFailedStories(currentState)) {
        // Collect all failed story IDs for selection
        const failedStories: Array<{ id: string; epicId: string }> = [];
        for (const epic of currentState.epics) {
          for (const story of epic.stories) {
            if (story.state === 'fail') {
              failedStories.push({ id: story.id, epicId: epic.id });
            }
          }
        }

        if (failedStories.length === 1) {
          // Only one failed story — invoke directly
          const storyId = failedStories[0].id;
          if (postRunCallbacks) {
            postRunCallbacks.onDiscuss(storyId);
          } else {
            enterDiscussMode(storyId);
          }
        } else {
          // Multiple failed stories — enter story-selection mode
          discussStoryIds = failedStories.map(s => s.id);

          // Build a selection prompt in the content area
          const lines = [
            'Select a failed story to discuss:',
            '',
            ...discussStoryIds.map((id, i) => `  [${i + 1}] ${id}`),
            '',
            "Press a number key to select, or 'q' to cancel.",
          ];
          epicListBox.setContent(lines.join('\n'));
          footerBox.setContent('Select story: 1-9 to pick  |  [q] cancel');
          screen.render();
        }
      }
      return;
    }
    // Guard: only toggle logs in non-summary modes
    if (currentState.viewMode === 'discuss') return;
    awaitingEpicNumber = false;
    discussStoryIds = [];
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

  // Digit keys: select epic if awaitingEpicNumber, or select story if discussStoryIds is set
  screen.key(['1', '2', '3', '4', '5', '6', '7', '8', '9'], (ch: string) => {
    if (!currentState) return;

    // Story selection for discuss mode takes priority
    if (discussStoryIds.length > 0) {
      const storyIndex = parseInt(ch, 10) - 1;
      if (storyIndex >= 0 && storyIndex < discussStoryIds.length) {
        const storyId = discussStoryIds[storyIndex];
        discussStoryIds = [];
        if (postRunCallbacks) {
          postRunCallbacks.onDiscuss(storyId);
        } else {
          enterDiscussMode(storyId);
        }
      }
      // Out-of-range digit: clear selection and re-render
      if (discussStoryIds.length > 0) {
        discussStoryIds = [];
        render();
      }
      return;
    }

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

  // 'r': context-sensitive
  //   - summary mode with failed stories → invoke onRetry callback (or no-op stub)
  //   - other modes → manual refresh
  screen.key(['r', 'R'], () => {
    if (!currentState) {
      render();
      return;
    }
    if (currentState.viewMode === 'summary') {
      if (computeHasFailedStories(currentState) && postRunCallbacks) {
        postRunCallbacks.onRetry();
      }
      // no-op when no callbacks or no failures
      return;
    }
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
