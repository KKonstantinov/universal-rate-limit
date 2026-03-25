import { describe, it, expect } from 'vitest';
import { getWindowWeight, computeSlidingWeight } from '../../src/lib/window-utils';

describe('getWindowWeight', () => {
    it('returns 1 at the start of a window (elapsed=0)', () => {
        expect(getWindowWeight(0, 1000)).toBe(1);
    });

    it('returns 0 at the end of a window (elapsed=windowMs)', () => {
        expect(getWindowWeight(1000, 1000)).toBe(0);
    });

    it('returns 0.5 at the midpoint', () => {
        expect(getWindowWeight(500, 1000)).toBe(0.5);
    });

    it('clamps to 0 for elapsed > windowMs', () => {
        expect(getWindowWeight(2000, 1000)).toBe(0);
    });
});

describe('computeSlidingWeight', () => {
    it('returns weight based on position within window', () => {
        const resetTime = new Date(Date.now() + 5000).toISOString();
        const weight = computeSlidingWeight(resetTime, 10_000);
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
    });

    it('returns a decaying value after resetTime has passed', () => {
        const pastResetTime = new Date(Date.now() - 1000).toISOString();
        const weight = computeSlidingWeight(pastResetTime, 10_000);
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
    });
});
