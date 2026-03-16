/**
 * time-utils.ts — Human-readable duration formatting for Ralph run stats.
 */

/**
 * Formats a duration in milliseconds into a compact human-readable string.
 *
 * Thresholds:
 * - ms < 1000   → "<1s"
 * - ms < 60000  → "Xs"          (e.g. "45s")
 * - ms < 3600000 → "Xm Ys"      (e.g. "4m 32s")
 * - otherwise   → "Xh Ym Zs"   (e.g. "1h 23m 45s")
 *
 * Zero-second/minute components are included (e.g. "1m 0s", "1h 0m 5s").
 *
 * @param ms - Duration in milliseconds (must be >= 0)
 * @returns Human-readable duration string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return '<1s';
  }

  const totalSeconds = Math.floor(ms / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours === 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${hours}h ${minutes}m ${seconds}s`;
}
