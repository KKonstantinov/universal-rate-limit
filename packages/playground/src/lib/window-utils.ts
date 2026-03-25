/** Sliding-window decay weight: 1 at the start of a window, 0 at the end. */
export function getWindowWeight(elapsed: number, windowMs: number): number {
    return Math.max(0, 1 - elapsed / windowMs);
}

export function computeSlidingWeight(resetTimeIso: string, windowMs: number, now = Date.now()): number {
    const resetMs = new Date(resetTimeIso).getTime();
    if (now < resetMs) {
        return getWindowWeight(now - (resetMs - windowMs), windowMs);
    }
    return getWindowWeight(now - resetMs, windowMs);
}
