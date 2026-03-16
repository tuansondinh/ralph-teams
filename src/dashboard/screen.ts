/**
 * dashboard/screen.ts — Blessed screen and widget setup for the TUI dashboard.
 *
 * Creates a blessed screen with:
 *   - Header box: top 3 lines (project name, wave, elapsed time, cost)
 *   - Epic list box: rows 3 to -2 (scrollable)
 *   - Footer box: bottom 1 line (key bindings)
 */

import * as blessed from 'blessed';
import { DashboardState } from './types';
import { renderHeader, renderEpicList, renderFooter } from './renderer';

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
 * @param onExit - Callback when user presses q/Escape/C-c
 */
export function createDashboardScreen(onExit: () => void): DashboardScreen {
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

  // Epic list: between header and footer
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
    content: renderFooter(),
  });

  // Key bindings
  screen.key(['q', 'Q', 'escape', 'C-c'], () => {
    onExit();
  });

  screen.key(['up', 'k'], () => {
    epicListBox.scroll(-1);
    screen.render();
  });

  screen.key(['down', 'j'], () => {
    epicListBox.scroll(1);
    screen.render();
  });

  screen.key(['r', 'R'], () => {
    screen.render();
  });

  // Give focus to the scrollable list
  epicListBox.focus();

  screen.render();

  function update(state: DashboardState): void {
    const headerLines = renderHeader(state);
    headerBox.setContent(headerLines.join('\n'));
    epicListBox.setContent(renderEpicList(state));
    screen.render();
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
