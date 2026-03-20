/**
 * Format a countdown value as either `M:SS` or `Ns`.
 *
 * @param secondsLeft - Remaining seconds to display.
 * @param showMinutes - When `true`, always use `M:SS` format even when under 60 s
 *   (useful for large windows like 5 m where `3s` looks odd). When `false` (default),
 *   `M:SS` is only used if `secondsLeft >= 60`.
 */
export function formatDuration(secondsLeft: number, showMinutes = false): string {
    const minutes = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    if (showMinutes || minutes > 0) {
        return `${String(minutes)}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(secondsLeft)}s`;
}
