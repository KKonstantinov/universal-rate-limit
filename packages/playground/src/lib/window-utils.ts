/** Index of the epoch-aligned window containing the given timestamp. */
export function getWindowIndex(windowMs: number, now = Date.now()): number {
    return Math.floor(now / windowMs);
}

/** Start timestamp (ms) of the epoch-aligned window containing the given timestamp. */
export function getWindowStart(windowMs: number, now = Date.now()): number {
    return getWindowIndex(windowMs, now) * windowMs;
}

/** Sliding-window decay weight: 1 at the start of a window, 0 at the end. */
export function getWindowWeight(elapsed: number, windowMs: number): number {
    return Math.max(0, 1 - elapsed / windowMs);
}

/** Whole seconds remaining until the next epoch-aligned window boundary. */
export function getSecondsUntilBoundary(windowMs: number): number {
    const now = Date.now();
    const nextReset = (getWindowIndex(windowMs, now) + 1) * windowMs;
    return Math.max(0, Math.ceil((nextReset - now) / 1000));
}

/** Fraction (0 → 1) of the current epoch-aligned window that has elapsed. */
export function getWindowElapsedFraction(windowMs: number): number {
    const now = Date.now();
    return Math.min(1, (now - getWindowStart(windowMs, now)) / windowMs);
}

export function computeSlidingWeight(resetTimeIso: string, windowMs: number, now = Date.now()): number {
    const resetMs = new Date(resetTimeIso).getTime();
    if (now < resetMs) {
        return getWindowWeight(now - (resetMs - windowMs), windowMs);
    }
    return getWindowWeight(now - resetMs, windowMs);
}
