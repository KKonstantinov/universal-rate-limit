import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../src/lib/format-utils';

describe('formatDuration', () => {
    it('returns "0s" for zero seconds', () => {
        expect(formatDuration(0)).toBe('0s');
    });

    it('returns seconds format for values under 60', () => {
        expect(formatDuration(5)).toBe('5s');
        expect(formatDuration(59)).toBe('59s');
    });

    it('returns M:SS format for values at or above 60', () => {
        expect(formatDuration(60)).toBe('1:00');
        expect(formatDuration(90)).toBe('1:30');
        expect(formatDuration(125)).toBe('2:05');
    });

    it('pads seconds with leading zero in M:SS format', () => {
        expect(formatDuration(61)).toBe('1:01');
        expect(formatDuration(300)).toBe('5:00');
    });

    it('forces M:SS format when showMinutes is true', () => {
        expect(formatDuration(5, true)).toBe('0:05');
        expect(formatDuration(0, true)).toBe('0:00');
        expect(formatDuration(30, true)).toBe('0:30');
    });

    it('clamps negative values to 0', () => {
        expect(formatDuration(-5)).toBe('0s');
        expect(formatDuration(-100, true)).toBe('0:00');
    });
});
