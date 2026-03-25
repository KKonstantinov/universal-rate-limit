import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rateLimit, MemoryStore, buildRateLimitResponse, fixedWindow, slidingWindow, tokenBucket } from '../../src/index.js';
import type { Store, RateLimitResult, Algorithm } from '../../src/index.js';

function createRequest(ip = '1.2.3.4', path = '/'): Request {
    return new Request(`http://localhost${path}`, {
        headers: { 'x-forwarded-for': ip }
    });
}

// ── Algorithm unit tests ────────────────────────────────────────────────────

describe('fixedWindow algorithm', () => {
    it('initializes state on first consume', () => {
        const algo = fixedWindow({ windowMs: 1000 });
        const { next, result } = algo.consume(undefined, 10, 5000);

        expect(result.limited).toBe(false);
        expect(result.remaining).toBe(9);
        expect(result.retryAfterMs).toBe(0);
        expect(next).toBeDefined();
    });

    it('increments hits within the same window', () => {
        const algo = fixedWindow({ windowMs: 1000 });
        const { next: s1 } = algo.consume(undefined, 10, 5000);
        const { next: s2, result: r2 } = algo.consume(s1, 10, 5100);

        expect(r2.remaining).toBe(8);
        expect(r2.limited).toBe(false);
        expect(s2).toBeDefined();
    });

    it('limits when hits exceed limit', () => {
        const algo = fixedWindow({ windowMs: 1000 });
        let state: unknown;
        for (let i = 0; i < 10; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        const { result } = algo.consume(state, 10, 5000);
        expect(result.limited).toBe(true);
        expect(result.remaining).toBe(0);
        expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('resets after window expires', () => {
        const algo = fixedWindow({ windowMs: 1000 });
        const { next: s1 } = algo.consume(undefined, 10, 5000);
        // Window started at 5000, expires at 6000
        const { result } = algo.consume(s1, 10, 6001);
        expect(result.limited).toBe(false);
        expect(result.remaining).toBe(9);
    });

    it('resetTime equals windowStart + windowMs', () => {
        const algo = fixedWindow({ windowMs: 1000 });
        const { result } = algo.consume(undefined, 10, 5000);
        expect(result.resetTime.getTime()).toBe(6000);
    });

    it('retryAfterMs is time until window end when limited', () => {
        const algo = fixedWindow({ windowMs: 1000 });
        let state: unknown;
        for (let i = 0; i < 11; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        // At 5500, window ends at 6000, so retryAfter = 500
        const { result } = algo.consume(state, 10, 5500);
        expect(result.retryAfterMs).toBe(500);
    });

    it('has correct name and config', () => {
        const algo = fixedWindow({ windowMs: 60_000 });
        expect(algo.name).toBe('fixed-window');
        expect(algo.config).toEqual({ windowMs: 60_000 });
    });

    it('ttlMs returns windowMs', () => {
        const algo = fixedWindow({ windowMs: 5000 });
        expect(algo.ttlMs(100)).toBe(5000);
    });
});

describe('slidingWindow algorithm', () => {
    it('initializes state on first consume', () => {
        const algo = slidingWindow({ windowMs: 1000 });
        const { next, result } = algo.consume(undefined, 10, 5000);

        expect(result.limited).toBe(false);
        expect(result.remaining).toBe(9);
        expect(result.retryAfterMs).toBe(0);
        expect(next).toBeDefined();
    });

    it('rotates current to previous when window expires', () => {
        const algo = slidingWindow({ windowMs: 1000 });
        // Fill 5 hits in window 1 (starting at 5000)
        let state: unknown;
        for (let i = 0; i < 5; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        // At 6500 (50% into window 2), previous = 5, weight = 0.5
        // totalHits = ceil(5 * 0.5 + 1) = ceil(3.5) = 4
        const { result } = algo.consume(state, 10, 6500);
        expect(result.remaining).toBe(6);
    });

    it('limits when weighted count exceeds limit', () => {
        const algo = slidingWindow({ windowMs: 1000 });
        let state: unknown;
        // Fill 10 hits starting at t=5000
        for (let i = 0; i < 10; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        // At 6001 (1ms into window 2), weight ~= 0.999
        // totalHits = ceil(10 * 0.999 + 1) = ceil(10.99) = 11 > 10
        const { result } = algo.consume(state, 10, 6001);
        expect(result.limited).toBe(true);
        expect(result.remaining).toBe(0);
    });

    it('previous hits fully expire after two windows', () => {
        const algo = slidingWindow({ windowMs: 1000 });
        let state: unknown;
        for (let i = 0; i < 10; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        // At 7001 (past two windows), previous hits are gone
        const { result } = algo.consume(state, 10, 7001);
        expect(result.limited).toBe(false);
        expect(result.remaining).toBe(9);
    });

    it('weight decays reducing previous window impact', () => {
        const algo = slidingWindow({ windowMs: 1000 });
        let state: unknown;
        for (let i = 0; i < 10; i++) {
            const { next } = algo.consume(state, 100, 5000);
            state = next;
        }

        // 25% into window 2: weight = 0.75
        // totalHits = ceil(10 * 0.75 + 1) = ceil(8.5) = 9, remaining = 91
        const { result: r25 } = algo.consume(state, 100, 6250);
        expect(r25.remaining).toBe(91);

        // For a different "user" (new state), at 50%: weight = 0.5
        // totalHits = ceil(10 * 0.5 + 1) = ceil(6) = 6, remaining = 94
        const { result: r50 } = algo.consume(state, 100, 6500);
        expect(r50.remaining).toBe(94);

        // At 75%: weight = 0.25
        // totalHits = ceil(10 * 0.25 + 1) = ceil(3.5) = 4, remaining = 96
        const { result: r75 } = algo.consume(state, 100, 6750);
        expect(r75.remaining).toBe(96);
    });

    it('includes retryAfterMs when limited', () => {
        const algo = slidingWindow({ windowMs: 1000 });
        let state: unknown;
        for (let i = 0; i < 10; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        const { result } = algo.consume(state, 10, 6001);
        expect(result.limited).toBe(true);
        expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('has correct name and config', () => {
        const algo = slidingWindow({ windowMs: 60_000 });
        expect(algo.name).toBe('sliding-window');
        expect(algo.config).toEqual({ windowMs: 60_000 });
    });

    it('ttlMs returns windowMs * 2', () => {
        const algo = slidingWindow({ windowMs: 5000 });
        expect(algo.ttlMs(100)).toBe(10_000);
    });
});

describe('tokenBucket algorithm', () => {
    it('initializes with full bucket minus 1 on first consume', () => {
        const algo = tokenBucket({ refillRate: 10 });
        const { result } = algo.consume(undefined, 10, 5000);

        expect(result.limited).toBe(false);
        expect(result.remaining).toBe(9);
        expect(result.retryAfterMs).toBe(0);
    });

    it('allows requests under capacity', () => {
        const algo = tokenBucket({ refillRate: 10 });
        let state: unknown;
        for (let i = 0; i < 10; i++) {
            const { next, result } = algo.consume(state, 10, 5000);
            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(10 - 1 - i);
            state = next;
        }
    });

    it('blocks when exhausted', () => {
        const algo = tokenBucket({ refillRate: 10 });
        let state: unknown;
        for (let i = 0; i < 10; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        const { result } = algo.consume(state, 10, 5000);
        expect(result.limited).toBe(true);
        expect(result.remaining).toBe(0);
    });

    it('refills over time', () => {
        const algo = tokenBucket({ refillRate: 10 });
        let state: unknown;
        // Exhaust all 10 tokens at t=5000
        for (let i = 0; i < 10; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        // Wait 200ms -> 10 * 0.2 = 2 tokens refilled
        const { result } = algo.consume(state, 10, 5200);
        expect(result.limited).toBe(false);
        expect(result.remaining).toBe(1); // 2 refilled, 1 consumed = 1 remaining
    });

    it('tokens cap at limit', () => {
        const algo = tokenBucket({ refillRate: 10 });
        // First request uses 1 token
        const { next: s1 } = algo.consume(undefined, 10, 5000);
        // Wait a very long time (10 seconds) — should refill fully but not exceed limit
        const { result } = algo.consume(s1, 10, 15_000);
        expect(result.remaining).toBe(9); // limit (10) capped, minus 1 consumed
    });

    it('retryAfterMs is time for 1 token to refill when exhausted', () => {
        const algo = tokenBucket({ refillRate: 10 });
        let state: unknown;
        for (let i = 0; i < 10; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        const { result } = algo.consume(state, 10, 5000);
        expect(result.limited).toBe(true);
        // 1 token / 10 per second = 100ms
        expect(result.retryAfterMs).toBe(100);
    });

    it('partial refill not enough for a request', () => {
        const algo = tokenBucket({ refillRate: 10 });
        let state: unknown;
        for (let i = 0; i < 10; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        // Wait 50ms -> 10 * 0.05 = 0.5 tokens (not enough)
        const { result } = algo.consume(state, 10, 5050);
        expect(result.limited).toBe(true);
    });

    it('has correct name and config', () => {
        const algo = tokenBucket({ refillRate: 10 });
        expect(algo.name).toBe('token-bucket');
        expect(algo.config).toEqual({ refillRate: 10, refillMs: 1000 });
    });

    it('ttlMs returns time to refill from empty', () => {
        const algo = tokenBucket({ refillRate: 10 });
        // limit=100, refillRate=10 -> 100/10*1000 = 10_000ms
        expect(algo.ttlMs(100)).toBe(10_000);
    });

    it('resetTime reflects time until bucket is full', () => {
        const algo = tokenBucket({ refillRate: 10 });
        let state: unknown;
        // Use 5 tokens at t=5000 (5 remaining)
        for (let i = 0; i < 5; i++) {
            const { next } = algo.consume(state, 10, 5000);
            state = next;
        }
        const { result } = algo.consume(state, 10, 5000);
        // 4 remaining, need to refill 6 more to reach 10
        // resetTime = 5000 + ceil(6 / 10 * 1000) = 5000 + 600 = 5600
        expect(result.resetTime.getTime()).toBe(5600);
    });
});

// ── rateLimit factory tests ─────────────────────────────────────────────────

describe('rateLimit', () => {
    describe('fixed window', () => {
        it('allows requests under the limit', async () => {
            const limiter = rateLimit({ limit: 3, algorithm: { type: 'fixed-window', windowMs: 60_000 } });
            const req = createRequest();

            const r1 = await limiter(req);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(2);
            expect(r1.limit).toBe(3);

            const r2 = await limiter(req);
            expect(r2.limited).toBe(false);
            expect(r2.remaining).toBe(1);

            const r3 = await limiter(req);
            expect(r3.limited).toBe(false);
            expect(r3.remaining).toBe(0);
        });

        it('blocks requests over the limit', async () => {
            const limiter = rateLimit({ limit: 2, algorithm: { type: 'fixed-window', windowMs: 60_000 } });
            const req = createRequest();

            await limiter(req);
            await limiter(req);
            const r3 = await limiter(req);

            expect(r3.limited).toBe(true);
            expect(r3.remaining).toBe(0);
        });

        it('tracks different keys separately', async () => {
            const limiter = rateLimit({ limit: 1, algorithm: { type: 'fixed-window', windowMs: 60_000 } });

            const r1 = await limiter(createRequest('1.1.1.1'));
            const r2 = await limiter(createRequest('2.2.2.2'));

            expect(r1.limited).toBe(false);
            expect(r2.limited).toBe(false);
        });

        it('resets after window expires', async () => {
            vi.useFakeTimers();
            try {
                const limiter = rateLimit({ limit: 1, algorithm: { type: 'fixed-window', windowMs: 1000 } });
                const req = createRequest();

                const r1 = await limiter(req);
                expect(r1.limited).toBe(false);

                const r2 = await limiter(req);
                expect(r2.limited).toBe(true);

                vi.advanceTimersByTime(1001);

                const r3 = await limiter(req);
                expect(r3.limited).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('sliding window', () => {
        it('uses weighted counting from previous window', async () => {
            vi.useFakeTimers();
            try {
                const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 1000 } });
                const req = createRequest();

                // Fill up 8 hits in the first window
                for (let i = 0; i < 8; i++) {
                    await limiter(req);
                }

                // Move halfway through the next window
                vi.advanceTimersByTime(1500);

                // At 50% through new window, previous weight = 0.5
                // Weighted count = ceil(8 * 0.5 + 1) = ceil(5) = 5 (not limited since < 10)
                const result = await limiter(req);
                expect(result.limited).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it('blocks when weighted count exceeds limit', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 1000 } });
                const req = createRequest();

                // Fill exactly at the limit in window 1
                for (let i = 0; i < 10; i++) {
                    const r = await limiter(req);
                    expect(r.limited).toBe(false);
                }

                // Advance just past the window boundary (1ms into window 2)
                // Previous weight ~= 0.999, totalHits = ceil(10 * 0.999 + 1) = 11 > 10
                vi.advanceTimersByTime(1001);
                const result = await limiter(req);
                expect(result.limited).toBe(true);
                expect(result.remaining).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it('weight decays over time reducing previous window impact', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 100, algorithm: { type: 'sliding-window', windowMs: 1000 } });

                // Fill 10 hits for 3 different IPs in window 1
                const ip1 = createRequest('10.0.0.1');
                const ip2 = createRequest('10.0.0.2');
                const ip3 = createRequest('10.0.0.3');
                for (let i = 0; i < 10; i++) {
                    await limiter(ip1);
                    await limiter(ip2);
                    await limiter(ip3);
                }

                // 25% into window 2: weight = 0.75
                // totalHits = ceil(10 * 0.75 + 1) = ceil(8.5) = 9, remaining = 91
                vi.advanceTimersByTime(1250);
                const r25 = await limiter(ip1);
                expect(r25.remaining).toBe(91);

                // 50% into window 2: weight = 0.5
                // totalHits = ceil(10 * 0.5 + 1) = ceil(6) = 6, remaining = 94
                vi.advanceTimersByTime(250);
                const r50 = await limiter(ip2);
                expect(r50.remaining).toBe(94);

                // 75% into window 2: weight = 0.25
                // totalHits = ceil(10 * 0.25 + 1) = ceil(3.5) = 4, remaining = 96
                vi.advanceTimersByTime(250);
                const r75 = await limiter(ip3);
                expect(r75.remaining).toBe(96);
            } finally {
                vi.useRealTimers();
            }
        });

        it('previous hits fully expire after two windows', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 1000 } });
                const req = createRequest();

                // Fill window 1 completely
                for (let i = 0; i < 10; i++) {
                    await limiter(req);
                }

                // Advance past two full windows — previous hits are too old to count
                vi.advanceTimersByTime(2001);
                const result = await limiter(req);
                expect(result.limited).toBe(false);
                expect(result.remaining).toBe(9);
            } finally {
                vi.useRealTimers();
            }
        });

        it('remaining reflects weighted calculation across requests', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 1000 } });
                const req = createRequest();

                // Fill 5 hits in window 1
                for (let i = 0; i < 5; i++) {
                    await limiter(req);
                }

                // Advance to 50% through window 2
                vi.advanceTimersByTime(1500);

                // Request 1: totalHits = ceil(5 * 0.5 + 1) = ceil(3.5) = 4, remaining = 6
                const r1 = await limiter(req);
                expect(r1.remaining).toBe(6);

                // Request 2: totalHits = ceil(5 * 0.5 + 2) = ceil(4.5) = 5, remaining = 5
                const r2 = await limiter(req);
                expect(r2.remaining).toBe(5);
            } finally {
                vi.useRealTimers();
            }
        });

        it('headers reflect weighted remaining under sliding-window', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
                const req = createRequest();

                // Fill 5 hits in window 1
                for (let i = 0; i < 5; i++) {
                    await limiter(req);
                }

                // Advance to 50% through window 2 (90s = 1.5 windows)
                vi.advanceTimersByTime(90_000);

                // weight = 0.5, totalHits = ceil(5 * 0.5 + 1) = 4, remaining = 6
                const result = await limiter(req);
                expect(result.headers['RateLimit']).toMatch(/limit=10, remaining=6, reset=\d+/);
                expect(result.headers['RateLimit-Policy']).toBe('10;w=60');
            } finally {
                vi.useRealTimers();
            }
        });

        it('includes Retry-After when limited under sliding-window', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 1000 } });
                const req = createRequest();

                // Fill limit in window 1
                for (let i = 0; i < 10; i++) {
                    await limiter(req);
                }

                // Advance just into window 2
                vi.advanceTimersByTime(1001);
                const result = await limiter(req);
                expect(result.limited).toBe(true);
                expect(result.headers).toHaveProperty('Retry-After');
                expect(Number(result.headers['Retry-After'])).toBeGreaterThan(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it('resetTime is windowStart + windowMs', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 1000 } });
                const req = createRequest();

                const result = await limiter(req);
                // Per-user window starts at request time (epoch 0), resets at 0 + 1000
                expect(result.resetTime.getTime()).toBe(new Date('2025-01-01T00:00:01.000Z').getTime());
            } finally {
                vi.useRealTimers();
            }
        });

        it('transitions from limited to allowed as weight decays', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 1000 } });
                const req = createRequest();

                // Fill exactly at limit
                for (let i = 0; i < 10; i++) {
                    await limiter(req);
                }

                // 50ms into window 2: weight = 0.95
                // ceil(10 * 0.95 + 1) = ceil(10.5) = 11 -> limited
                vi.advanceTimersByTime(1050);
                const r1 = await limiter(req);
                expect(r1.limited).toBe(true);

                // After enough decay, should recover
                vi.advanceTimersByTime(199);
                const r2 = await limiter(req);
                expect(r2.limited).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('token bucket', () => {
        it('allows requests under capacity', async () => {
            const limiter = rateLimit({ limit: 5, algorithm: { type: 'token-bucket', refillRate: 10 } });
            const req = createRequest();

            for (let i = 0; i < 5; i++) {
                const r = await limiter(req);
                expect(r.limited).toBe(false);
                expect(r.remaining).toBe(5 - 1 - i);
            }
        });

        it('blocks when tokens exhausted', async () => {
            const limiter = rateLimit({ limit: 3, algorithm: { type: 'token-bucket', refillRate: 10 } });
            const req = createRequest();

            await limiter(req);
            await limiter(req);
            await limiter(req);

            const r4 = await limiter(req);
            expect(r4.limited).toBe(true);
            expect(r4.remaining).toBe(0);
        });

        it('refills over time', async () => {
            vi.useFakeTimers();
            try {
                const limiter = rateLimit({ limit: 5, algorithm: { type: 'token-bucket', refillRate: 10 } });
                const req = createRequest();

                // Exhaust all tokens
                for (let i = 0; i < 5; i++) {
                    await limiter(req);
                }

                // Confirm exhausted
                const blocked = await limiter(req);
                expect(blocked.limited).toBe(true);

                // Wait 200ms -> 10 * 0.2 = 2 tokens refilled
                vi.advanceTimersByTime(200);
                const r = await limiter(req);
                expect(r.limited).toBe(false);
                expect(r.remaining).toBe(1); // 2 refilled, 1 consumed
            } finally {
                vi.useRealTimers();
            }
        });

        it('includes Retry-After when limited', async () => {
            const limiter = rateLimit({ limit: 1, algorithm: { type: 'token-bucket', refillRate: 10 } });
            const req = createRequest();

            await limiter(req);
            const limited = await limiter(req);

            expect(limited.limited).toBe(true);
            expect(limited.headers).toHaveProperty('Retry-After');
            expect(Number(limited.headers['Retry-After'])).toBeGreaterThan(0);
        });

        it('tracks different keys separately', async () => {
            const limiter = rateLimit({ limit: 1, algorithm: { type: 'token-bucket', refillRate: 10 } });

            const r1 = await limiter(createRequest('1.1.1.1'));
            const r2 = await limiter(createRequest('2.2.2.2'));

            expect(r1.limited).toBe(false);
            expect(r2.limited).toBe(false);
        });

        it('policy header uses ceil(limit / refillRate)', async () => {
            const limiter = rateLimit({ limit: 100, algorithm: { type: 'token-bucket', refillRate: 10 } });
            const result = await limiter(createRequest());

            // w = ceil(100 / 10) = 10
            expect(result.headers['RateLimit-Policy']).toBe('100;w=10');
        });
    });

    describe('default algorithm', () => {
        it('defaults to sliding-window with 60_000ms windowMs when no algorithm specified', async () => {
            const limiter = rateLimit({ limit: 10 });
            const result = await limiter(createRequest());

            // Should have w=60 in policy header (60_000ms = 60s)
            expect(result.headers['RateLimit-Policy']).toBe('10;w=60');
        });
    });

    describe('custom algorithm', () => {
        it('accepts a raw Algorithm object', async () => {
            const customAlgo: Algorithm = {
                name: 'custom',
                config: { windowMs: 1000 },
                consume(state: number | undefined, limit: number, _nowMs: number) {
                    const hits = (state ?? 0) + 1;
                    return {
                        next: hits,
                        result: {
                            limited: hits > limit,
                            remaining: Math.max(0, limit - hits),
                            resetTime: new Date(_nowMs + 1000),
                            retryAfterMs: hits > limit ? 1000 : 0
                        }
                    };
                },
                ttlMs() {
                    return 1000;
                }
            };

            const limiter = rateLimit({ limit: 2, algorithm: customAlgo });
            const req = createRequest();

            const r1 = await limiter(req);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(1);

            const r2 = await limiter(req);
            expect(r2.limited).toBe(false);
            expect(r2.remaining).toBe(0);

            const r3 = await limiter(req);
            expect(r3.limited).toBe(true);
        });
    });

    describe('options', () => {
        it('uses custom keyGenerator', async () => {
            const limiter = rateLimit({
                limit: 1,
                algorithm: { type: 'fixed-window', windowMs: 60_000 },
                keyGenerator: (req: Request) => req.headers.get('x-api-key') ?? 'unknown'
            });

            const req1 = new Request('http://localhost/', { headers: { 'x-api-key': 'key-a' } });
            const req2 = new Request('http://localhost/', { headers: { 'x-api-key': 'key-b' } });

            const r1 = await limiter(req1);
            const r2 = await limiter(req2);

            expect(r1.limited).toBe(false);
            expect(r2.limited).toBe(false);
        });

        it('supports async limit function', async () => {
            const limiter = rateLimit({
                limit: async () => 2,
                algorithm: { type: 'sliding-window', windowMs: 60_000 }
            });

            const req = createRequest();
            const r1 = await limiter(req);
            expect(r1.limit).toBe(2);
            expect(r1.remaining).toBe(1);
        });

        it('respects skip function', async () => {
            const limiter = rateLimit({
                limit: 1,
                algorithm: { type: 'fixed-window', windowMs: 60_000 },
                skip: (req: Request) => req.url.includes('/health')
            });

            const healthReq = createRequest('1.2.3.4', '/health');

            // Fire the health endpoint multiple times — should never be counted
            await limiter(healthReq);
            await limiter(healthReq);
            await limiter(healthReq);

            const normalReq = createRequest('1.2.3.4', '/');
            const r1 = await limiter(normalReq);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(0);

            const r2 = await limiter(normalReq);
            expect(r2.limited).toBe(true);
        });

        it('uses custom statusCode', async () => {
            const result: RateLimitResult = {
                limited: true,
                limit: 1,
                remaining: 0,
                resetTime: new Date(Date.now() + 60_000),
                headers: {}
            };

            const response = await buildRateLimitResponse(createRequest(), result, {
                statusCode: 503
            });

            expect(response.status).toBe(503);
        });

        it('uses custom string message', async () => {
            const result: RateLimitResult = {
                limited: true,
                limit: 1,
                remaining: 0,
                resetTime: new Date(Date.now() + 60_000),
                headers: {}
            };

            const response = await buildRateLimitResponse(createRequest(), result, {
                message: 'Slow down!'
            });

            expect(await response.text()).toBe('Slow down!');
        });

        it('uses custom JSON message', async () => {
            const result: RateLimitResult = {
                limited: true,
                limit: 1,
                remaining: 0,
                resetTime: new Date(Date.now() + 60_000),
                headers: {}
            };

            const response = await buildRateLimitResponse(createRequest(), result, {
                message: { error: 'rate_limited' }
            });

            expect(await response.json()).toEqual({ error: 'rate_limited' });
        });

        it('uses custom function message', async () => {
            const result: RateLimitResult = {
                limited: true,
                limit: 1,
                remaining: 0,
                resetTime: new Date(Date.now() + 60_000),
                headers: {}
            };

            const response = await buildRateLimitResponse(createRequest(), result, {
                message: () => 'dynamic message'
            });

            expect(await response.text()).toBe('dynamic message');
        });

        it('calls custom handler when limited', async () => {
            const result: RateLimitResult = {
                limited: true,
                limit: 1,
                remaining: 0,
                resetTime: new Date(Date.now() + 60_000),
                headers: {}
            };

            const response = await buildRateLimitResponse(createRequest(), result, {
                handler: () => new Response('Custom!', { status: 503 })
            });

            expect(response.status).toBe(503);
            expect(await response.text()).toBe('Custom!');
        });

        it('failOpen allows requests when store fails', async () => {
            const failingStore: Store = {
                consume: async () => {
                    throw new Error('Store down');
                },
                resetKey: async () => {},
                resetAll: async () => {}
            };

            const limiter = rateLimit({
                limit: 1,
                algorithm: { type: 'sliding-window', windowMs: 60_000 },
                store: failingStore,
                failOpen: true
            });

            const result = await limiter(createRequest());
            expect(result.limited).toBe(false);
        });

        it('throws when store fails and failOpen is false', async () => {
            const failingStore: Store = {
                consume: async () => {
                    throw new Error('Store down');
                },
                resetKey: async () => {},
                resetAll: async () => {}
            };

            const limiter = rateLimit({
                limit: 1,
                algorithm: { type: 'sliding-window', windowMs: 60_000 },
                store: failingStore,
                failOpen: false
            });

            await expect(limiter(createRequest())).rejects.toThrow('Rate limit store error');
        });
    });

    describe('headers', () => {
        it('generates draft-7 headers by default', async () => {
            const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
            const result = await limiter(createRequest());

            expect(result.headers).toHaveProperty('RateLimit');
            expect(result.headers).toHaveProperty('RateLimit-Policy');
            expect(result.headers['RateLimit']).toMatch(/limit=10, remaining=9, reset=\d+/);
            expect(result.headers['RateLimit-Policy']).toBe('10;w=60');
        });

        it('generates draft-6 headers when configured', async () => {
            const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 60_000 }, headers: 'draft-6' });
            const result = await limiter(createRequest());

            expect(result.headers).toHaveProperty('RateLimit-Limit');
            expect(result.headers).toHaveProperty('RateLimit-Remaining');
            expect(result.headers).toHaveProperty('RateLimit-Reset');
            expect(result.headers['RateLimit-Limit']).toBe('10');
            expect(result.headers['RateLimit-Remaining']).toBe('9');
        });

        it('includes legacy X-RateLimit headers when legacyHeaders is true', async () => {
            const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 60_000 }, legacyHeaders: true });
            const result = await limiter(createRequest());

            // Standard draft-7 headers should still be present
            expect(result.headers).toHaveProperty('RateLimit');
            expect(result.headers).toHaveProperty('RateLimit-Policy');
            // Legacy headers should also be present
            expect(result.headers['X-RateLimit-Limit']).toBe('10');
            expect(result.headers['X-RateLimit-Remaining']).toBe('9');
            expect(result.headers['X-RateLimit-Reset']).toMatch(/^\d+$/);
        });

        it('includes legacy headers alongside draft-6', async () => {
            const limiter = rateLimit({
                limit: 10,
                algorithm: { type: 'sliding-window', windowMs: 60_000 },
                headers: 'draft-6',
                legacyHeaders: true
            });
            const result = await limiter(createRequest());

            // Standard draft-6 headers
            expect(result.headers['RateLimit-Limit']).toBe('10');
            expect(result.headers['RateLimit-Remaining']).toBe('9');
            // Legacy headers
            expect(result.headers['X-RateLimit-Limit']).toBe('10');
            expect(result.headers['X-RateLimit-Remaining']).toBe('9');
        });

        it('does not include legacy headers by default', async () => {
            const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
            const result = await limiter(createRequest());

            expect(result.headers).not.toHaveProperty('X-RateLimit-Limit');
        });

        it('includes Retry-After header when rate-limited', async () => {
            const limiter = rateLimit({ limit: 1, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
            const req = createRequest();

            await limiter(req);
            const limited = await limiter(req);

            expect(limited.limited).toBe(true);
            expect(limited.headers).toHaveProperty('Retry-After');
            expect(limited.headers['Retry-After']).toMatch(/^\d+$/);
        });

        it('does not include Retry-After header when not rate-limited', async () => {
            const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
            const result = await limiter(createRequest());

            expect(result.limited).toBe(false);
            expect(result.headers).not.toHaveProperty('Retry-After');
        });

        it('includes Retry-After header with draft-6 headers', async () => {
            const limiter = rateLimit({ limit: 1, algorithm: { type: 'sliding-window', windowMs: 60_000 }, headers: 'draft-6' });
            const req = createRequest();

            await limiter(req);
            const limited = await limiter(req);

            expect(limited.limited).toBe(true);
            expect(limited.headers).toHaveProperty('Retry-After');
            expect(limited.headers).toHaveProperty('RateLimit-Reset');
        });
    });

    describe('default key generator', () => {
        it('extracts IP from x-forwarded-for', async () => {
            const limiter = rateLimit({ limit: 1, algorithm: { type: 'sliding-window', windowMs: 60_000 } });

            const req = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }
            });

            const result = await limiter(req);
            expect(result.limited).toBe(false);

            // Same first IP should be rate limited
            const result2 = await limiter(req);
            expect(result2.limited).toBe(true);
        });

        it('falls back to 127.0.0.1 when no IP headers present', async () => {
            const limiter = rateLimit({ limit: 1, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
            const req = new Request('http://localhost/');

            const result = await limiter(req);
            expect(result.limited).toBe(false);

            const result2 = await limiter(req);
            expect(result2.limited).toBe(true);
        });
    });
});

// ── MemoryStore tests ───────────────────────────────────────────────────────

describe('MemoryStore', () => {
    let store: MemoryStore;
    const algo = fixedWindow({ windowMs: 60_000 });

    beforeEach(() => {
        store = new MemoryStore();
    });

    afterEach(() => {
        store.shutdown();
    });

    it('consume returns first-request values on empty store', () => {
        const result = store.consume('key1', algo, 10);
        expect(result).toHaveProperty('limited', false);
        expect(result).toHaveProperty('remaining', 9);
    });

    it('consume accumulates hits for same key', () => {
        const r1 = store.consume('key1', algo, 10);
        expect(r1.remaining).toBe(9);

        const r2 = store.consume('key1', algo, 10);
        expect(r2.remaining).toBe(8);
    });

    it('consume treats expired entries as new', () => {
        vi.useFakeTimers();
        try {
            const shortAlgo = fixedWindow({ windowMs: 1000 });
            store.consume('key1', shortAlgo, 10);
            store.consume('key1', shortAlgo, 10);

            vi.advanceTimersByTime(1500);

            const result = store.consume('key1', shortAlgo, 10);
            expect(result.remaining).toBe(9);
        } finally {
            vi.useRealTimers();
        }
    });

    it('resetKey clears a single key', () => {
        store.consume('key1', algo, 10);
        store.consume('key1', algo, 10);
        store.resetKey('key1');

        const result = store.consume('key1', algo, 10);
        expect(result.remaining).toBe(9);
    });

    it('resetAll clears all keys', () => {
        store.consume('key1', algo, 10);
        store.consume('key2', algo, 10);
        store.resetAll();

        const r1 = store.consume('key1', algo, 10);
        const r2 = store.consume('key2', algo, 10);
        expect(r1.remaining).toBe(9);
        expect(r2.remaining).toBe(9);
    });

    it('peek returns current state without modifying it', () => {
        store.consume('key1', algo, 10);

        // Peek should show remaining = 9 (after 1 consume)
        const peekResult = store.peek('key1', algo, 10);
        expect(peekResult).toBeDefined();
        expect(peekResult!.remaining).toBe(9);

        // Next consume should see remaining = 8 (not 7, proving peek didn't modify state)
        const r2 = store.consume('key1', algo, 10);
        expect(r2.remaining).toBe(8);
    });

    it('peek returns undefined for unknown key', () => {
        const result = store.peek('nonexistent', algo, 10);
        expect(result).toBeUndefined();
    });

    it('resetTime is in the future', () => {
        const result = store.consume('key1', algo, 10);
        expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
    });

    it('works with different algorithm types', () => {
        const tbAlgo = tokenBucket({ refillRate: 10 });
        const result = store.consume('key1', tbAlgo, 10);
        expect(result.limited).toBe(false);
        expect(result.remaining).toBe(9);
    });

    it('shutdown stops the cleanup timer', () => {
        store.shutdown();
        // Should not throw or cause issues
        store.shutdown(); // Double-shutdown is safe
    });
});

// ── Hardened interface tests ─────────────────────────────────────────────────

describe('hardened interfaces', () => {
    // ── 1. Algorithm.config with non-number values ───────────────────────

    describe('Algorithm.config with non-number values', () => {
        it('accepts a custom algorithm with string config values', async () => {
            const customAlgo: Algorithm = {
                name: 'custom-string-config',
                config: { mode: 'strict', version: '2' } as Record<string, unknown>,
                consume(state: number | undefined, limit: number, nowMs: number) {
                    const hits = (state ?? 0) + 1;
                    return {
                        next: hits,
                        result: {
                            limited: hits > limit,
                            remaining: Math.max(0, limit - hits),
                            resetTime: new Date(nowMs + 1000),
                            retryAfterMs: hits > limit ? 1000 : 0
                        }
                    };
                },
                ttlMs() {
                    return 1000;
                }
            };

            const limiter = rateLimit({ limit: 5, algorithm: customAlgo });
            const req = createRequest();

            const r1 = await limiter(req);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(4);
        });

        it('Algorithm.config preserves non-number values through resolution', () => {
            const customAlgo: Algorithm = {
                name: 'mixed-config',
                config: { windowMs: 5000, strategy: 'aggressive' } as Record<string, unknown>,
                consume(state: unknown, limit: number, nowMs: number) {
                    return {
                        next: state,
                        result: {
                            limited: false,
                            remaining: limit,
                            resetTime: new Date(nowMs + 5000),
                            retryAfterMs: 0
                        }
                    };
                },
                ttlMs() {
                    return 5000;
                }
            };

            expect(customAlgo.config).toHaveProperty('strategy', 'aggressive');
            expect(customAlgo.config).toHaveProperty('windowMs', 5000);
        });
    });

    // ── 4. MemoryStore options object constructor ────────────────────────

    describe('MemoryStore constructor options', () => {
        it('new MemoryStore() with no args still works', () => {
            const store = new MemoryStore();
            const algo = fixedWindow({ windowMs: 60_000 });

            const result = store.consume('key1', algo, 10);
            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(9);

            store.shutdown();
        });

        it('accepts options object with prefix', () => {
            const store = new MemoryStore({ prefix: 'test:' });
            const algo = fixedWindow({ windowMs: 60_000 });

            store.consume('key1', algo, 10);
            store.consume('key1', algo, 10);

            const result = store.consume('key1', algo, 10);
            expect(result.remaining).toBe(7);

            store.shutdown();
        });

        it('accepts options object with cleanupIntervalMs', () => {
            vi.useFakeTimers();
            try {
                const store = new MemoryStore({ cleanupIntervalMs: 500 });
                const shortAlgo = fixedWindow({ windowMs: 200 });

                store.consume('key1', shortAlgo, 10);

                // Advance past TTL and cleanup interval
                vi.advanceTimersByTime(600);

                // After cleanup, expired entry should be gone, treating as new
                const result = store.consume('key1', shortAlgo, 10);
                expect(result.remaining).toBe(9);

                store.shutdown();
            } finally {
                vi.useRealTimers();
            }
        });

        it('accepts options object with both prefix and cleanupIntervalMs', () => {
            const store = new MemoryStore({ prefix: 'app:', cleanupIntervalMs: 30_000 });
            const algo = fixedWindow({ windowMs: 60_000 });

            const result = store.consume('key1', algo, 10);
            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(9);

            store.shutdown();
        });

        it('prefix from options object is applied to keys', () => {
            const store = new MemoryStore({ prefix: 'pfx:' });
            expect(store.prefix).toBe('pfx:');
            store.shutdown();
        });
    });

    // ── 5. Cost-based consumption ────────────────────────────────────────

    describe('cost-based consumption', () => {
        describe('cost option on rateLimit()', () => {
            it('static cost=2 deducts 2 units per request', async () => {
                const limiter = rateLimit({
                    limit: 10,
                    cost: 2,
                    algorithm: { type: 'token-bucket', refillRate: 10 }
                });
                const req = createRequest();

                const r1 = await limiter(req);
                expect(r1.remaining).toBe(8); // 10 - 2 = 8

                const r2 = await limiter(req);
                expect(r2.remaining).toBe(6); // 8 - 2 = 6
            });

            it('cost function resolves per-request', async () => {
                const limiter = rateLimit({
                    limit: 10,
                    cost: (req: Request) => (req.headers.get('x-cost') ? Number(req.headers.get('x-cost')) : 1),
                    algorithm: { type: 'fixed-window', windowMs: 60_000 }
                });

                const r1 = await limiter(createRequest());
                expect(r1.remaining).toBe(9); // default cost=1

                const expensiveReq = new Request('http://localhost/', {
                    headers: { 'x-forwarded-for': '1.2.3.4', 'x-cost': '3' }
                });
                const r2 = await limiter(expensiveReq);
                expect(r2.remaining).toBe(6); // 9 - 3 = 6
            });

            it('async cost function resolves per-request', async () => {
                const limiter = rateLimit({
                    limit: 10,
                    cost: async () => 5,
                    algorithm: { type: 'fixed-window', windowMs: 60_000 }
                });

                const r1 = await limiter(createRequest());
                expect(r1.remaining).toBe(5); // 10 - 5 = 5
            });

            it('cost=0 does not consume capacity', async () => {
                const limiter = rateLimit({
                    limit: 10,
                    cost: 0,
                    algorithm: { type: 'fixed-window', windowMs: 60_000 }
                });

                const r1 = await limiter(createRequest());
                expect(r1.remaining).toBe(10);
                expect(r1.limited).toBe(false);
            });
        });

        describe('token bucket with cost', () => {
            it('cost=2 deducts 2 tokens at algorithm level', () => {
                const algo = tokenBucket({ refillRate: 10 });

                // First consume with default cost (1)
                const { next: s1, result: r1 } = algo.consume(undefined, 10, 5000);
                expect(r1.remaining).toBe(9);

                // Second consume with cost=2 should deduct 2 tokens
                const { result: r2 } = algo.consume(s1, 10, 5000, 2);
                expect(r2.remaining).toBe(7); // 9 - 2 = 7
            });

            it('blocks when cost exceeds remaining tokens', () => {
                const algo = tokenBucket({ refillRate: 10 });

                // Use 9 tokens (1 at a time)
                let state: unknown;
                for (let i = 0; i < 9; i++) {
                    const { next } = algo.consume(state, 10, 5000);
                    state = next;
                }

                // Cost=2 but only 1 token left
                const { result } = algo.consume(state, 10, 5000, 2);
                expect(result.limited).toBe(true);
                expect(result.remaining).toBe(0);
            });

            it('default cost=1 behavior is unchanged', () => {
                const algo = tokenBucket({ refillRate: 10 });
                const { result: r1 } = algo.consume(undefined, 10, 5000);
                expect(r1.remaining).toBe(9); // limit(10) - cost(1) = 9
            });

            it('blocks first request when cost exceeds capacity', () => {
                const algo = tokenBucket({ refillRate: 10 });
                const { next, result } = algo.consume(undefined, 5, 5000, 10);
                expect(result.limited).toBe(true);
                expect(result.remaining).toBe(0);
                expect(result.retryAfterMs).toBeGreaterThan(0);
                // State should preserve full bucket (nothing was consumed)
                expect(next.tokens).toBe(5);
            });
        });

        describe('fixed window with cost', () => {
            it('cost=2 adds 2 hits at algorithm level', () => {
                const algo = fixedWindow({ windowMs: 1000 });

                const { next: s1, result: r1 } = algo.consume(undefined, 10, 5000);
                expect(r1.remaining).toBe(9);

                // cost=2 should add 2 hits
                const { result: r2 } = algo.consume(s1, 10, 5000, 2);
                expect(r2.remaining).toBe(7); // 10 - (1 + 2) = 7
            });

            it('default cost=1 behavior is unchanged for fixed window', () => {
                const algo = fixedWindow({ windowMs: 1000 });
                const { result } = algo.consume(undefined, 10, 5000);
                expect(result.remaining).toBe(9);
            });
        });

        describe('sliding window with cost', () => {
            it('cost=2 adds 2 hits at algorithm level', () => {
                const algo = slidingWindow({ windowMs: 1000 });

                const { next: s1, result: r1 } = algo.consume(undefined, 10, 5000);
                expect(r1.remaining).toBe(9);

                // cost=2 should add 2 current hits
                const { result: r2 } = algo.consume(s1, 10, 5000, 2);
                expect(r2.remaining).toBe(7); // 10 - (1 + 2) = 7
            });
        });

        describe('MemoryStore with cost', () => {
            it('passes cost through to algorithm', () => {
                const store = new MemoryStore();
                const algo = fixedWindow({ windowMs: 60_000 });

                const r1 = store.consume('key1', algo, 10);
                expect(r1.remaining).toBe(9);

                // consume with cost=3
                const r2 = store.consume('key1', algo, 10, 3);
                expect(r2.remaining).toBe(6); // 10 - (1 + 3) = 6

                store.shutdown();
            });
        });
    });

    // ── 6. limit: 0 edge case ────────────────────────────────────────────

    describe('limit: 0 (maintenance mode / kill switch)', () => {
        it('rejects every request when limit is 0', async () => {
            const limiter = rateLimit({ limit: 0, algorithm: { type: 'fixed-window', windowMs: 60_000 } });
            const result = await limiter(createRequest());
            expect(result.limited).toBe(true);
            expect(result.remaining).toBe(0);
        });
    });

    // ── 7. resolveAlgorithm edge cases ───────────────────────────────────

    describe('resolveAlgorithm edge cases', () => {
        it('AlgorithmConfig with extra properties is accepted', async () => {
            // The discriminated union should still work if extra properties exist
            const config = { type: 'fixed-window' as const, windowMs: 5000, description: 'test' };
            const limiter = rateLimit({
                limit: 10,
                algorithm: config as { type: 'fixed-window'; windowMs: number }
            });
            const result = await limiter(createRequest());
            expect(result.limited).toBe(false);
            expect(result.headers['RateLimit-Policy']).toBe('10;w=5');
        });

        it('raw Algorithm object with name and consume is recognized', async () => {
            const rawAlgo: Algorithm = {
                name: 'my-algorithm',
                config: { windowMs: 2000 },
                consume(state: number | undefined, limit: number, nowMs: number) {
                    const hits = (state ?? 0) + 1;
                    return {
                        next: hits,
                        result: {
                            limited: hits > limit,
                            remaining: Math.max(0, limit - hits),
                            resetTime: new Date(nowMs + 2000),
                            retryAfterMs: hits > limit ? 2000 : 0
                        }
                    };
                },
                ttlMs() {
                    return 2000;
                }
            };

            const limiter = rateLimit({ limit: 5, algorithm: rawAlgo });
            const req = createRequest();

            const r1 = await limiter(req);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(4);
        });

        it('does not confuse AlgorithmConfig with type field as raw Algorithm', async () => {
            // An AlgorithmConfig has `type`, a raw Algorithm has `consume` + `name`
            // This should be resolved as a config, not a raw Algorithm
            const limiter = rateLimit({
                limit: 10,
                algorithm: { type: 'token-bucket', refillRate: 5 }
            });
            const result = await limiter(createRequest());
            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(9);
        });

        it('raw Algorithm without type field is not treated as config', async () => {
            // A raw Algorithm that happens to have no `type` field
            const rawAlgo: Algorithm = {
                name: 'no-type-field',
                config: {},
                consume(state: number | undefined, limit: number, nowMs: number) {
                    const hits = (state ?? 0) + 1;
                    return {
                        next: hits,
                        result: {
                            limited: hits > limit,
                            remaining: Math.max(0, limit - hits),
                            resetTime: new Date(nowMs + 1000),
                            retryAfterMs: 0
                        }
                    };
                },
                ttlMs() {
                    return 1000;
                }
            };

            const limiter = rateLimit({ limit: 3, algorithm: rawAlgo });
            const r1 = await limiter(createRequest());
            expect(r1.remaining).toBe(2);
        });
    });

    // ── 7. Store.unconsume() ────────────────────────────────────────────────

    describe('Store.unconsume()', () => {
        it('MemoryStore.unconsume restores capacity after consume', () => {
            const store = new MemoryStore();
            const algo = fixedWindow({ windowMs: 60_000 });

            // Consume 3 times
            store.consume('key1', algo, 10);
            store.consume('key1', algo, 10);
            store.consume('key1', algo, 10);

            // remaining should be 7
            const beforeUnconsume = store.peek('key1', algo, 10);
            expect(beforeUnconsume?.remaining).toBe(7);

            // Unconsume 1
            store.unconsume('key1', algo, 10);

            // remaining should be restored to 8
            const afterUnconsume = store.peek('key1', algo, 10);
            expect(afterUnconsume?.remaining).toBe(8);

            store.shutdown();
        });

        it('unconsume with cost restores the specified cost amount', () => {
            const store = new MemoryStore();
            const algo = fixedWindow({ windowMs: 60_000 });

            store.consume('key1', algo, 10);
            store.consume('key1', algo, 10);
            store.consume('key1', algo, 10);

            // Unconsume with cost=2
            store.unconsume('key1', algo, 10, 2);

            const afterUnconsume = store.peek('key1', algo, 10);
            expect(afterUnconsume?.remaining).toBe(9); // 7 + 2 = 9

            store.shutdown();
        });

        it('unconsume on non-existent key does not throw', () => {
            const store = new MemoryStore();
            const algo = fixedWindow({ windowMs: 60_000 });

            // Should not throw
            expect(() => store.unconsume('nonexistent', algo, 10)).not.toThrow();

            store.shutdown();
        });

        it('unconsume is optional on Store interface', () => {
            // A store without unconsume should still be valid
            const minimalStore: Store = {
                consume() {
                    return { limited: false, remaining: 10, resetTime: new Date(), retryAfterMs: 0 };
                },
                resetKey() {},
                resetAll() {}
            };

            expect('unconsume' in minimalStore && minimalStore.unconsume !== undefined).toBe(false);
        });
    });

    // ── 8. tokenBucket with bucketSize ───────────────────────────────────

    describe('tokenBucket with bucketSize', () => {
        it('bucketSize limits capacity independently from limit', () => {
            // limit=100 but bucketSize=5 — bucket holds max 5 tokens
            const algo = tokenBucket({ refillRate: 10, bucketSize: 5 });

            const { result: r1 } = algo.consume(undefined, 100, 5000);
            expect(r1.limited).toBe(false);
            // Bucket started at bucketSize (5), consumed 1 → 4 remaining
            expect(r1.remaining).toBe(4);
        });

        it('bucketSize caps token refill', () => {
            vi.useFakeTimers();
            try {
                const algo = tokenBucket({ refillRate: 10, bucketSize: 5 });

                // Exhaust all 5 tokens
                let state: unknown;
                for (let i = 0; i < 5; i++) {
                    const { next } = algo.consume(state, 100, 5000);
                    state = next;
                }

                // Wait long enough to refill more than bucketSize
                // 10 tokens/sec * 2s = 20 tokens, but capped at bucketSize=5
                const { result } = algo.consume(state, 100, 7000);
                expect(result.limited).toBe(false);
                expect(result.remaining).toBe(4); // min(5, refilled) - 1 consumed = 4
            } finally {
                vi.useRealTimers();
            }
        });

        it('blocks when bucketSize tokens exhausted even though limit is higher', () => {
            const algo = tokenBucket({ refillRate: 10, bucketSize: 3 });

            let state: unknown;
            for (let i = 0; i < 3; i++) {
                const { next } = algo.consume(state, 100, 5000);
                state = next;
            }

            const { result } = algo.consume(state, 100, 5000);
            expect(result.limited).toBe(true);
            expect(result.remaining).toBe(0);
        });

        it('without bucketSize, capacity defaults to limit', () => {
            const algo = tokenBucket({ refillRate: 10 });

            const { result } = algo.consume(undefined, 10, 5000);
            expect(result.remaining).toBe(9); // limit=10, consumed 1 → 9
        });

        it('config includes bucketSize when provided', () => {
            const algo = tokenBucket({ refillRate: 10, bucketSize: 50 });
            expect(algo.config).toHaveProperty('refillRate', 10);
            expect(algo.config).toHaveProperty('bucketSize', 50);
        });

        it('config does not include bucketSize when not provided', () => {
            const algo = tokenBucket({ refillRate: 10 });
            expect(algo.config).toHaveProperty('refillRate', 10);
            expect(algo.config).not.toHaveProperty('bucketSize');
        });

        it('ttlMs uses bucketSize when provided', () => {
            const algo = tokenBucket({ refillRate: 10, bucketSize: 50 });
            // ttlMs should be based on bucketSize, not limit
            // ceil(50 / 10 * 1000) = 5000
            expect(algo.ttlMs(100)).toBe(5000);
        });

        it('through rateLimit factory with bucketSize', async () => {
            const limiter = rateLimit({
                limit: 100,
                algorithm: { type: 'token-bucket', refillRate: 10, bucketSize: 3 }
            });
            const req = createRequest();

            // Only 3 tokens available despite limit=100
            const r1 = await limiter(req);
            expect(r1.remaining).toBe(2);

            const r2 = await limiter(req);
            expect(r2.remaining).toBe(1);

            const r3 = await limiter(req);
            expect(r3.remaining).toBe(0);

            const r4 = await limiter(req);
            expect(r4.limited).toBe(true);
        });
    });

    // ── 9.3a Token Bucket: refillMs option ───────────────────────────────

    describe('tokenBucket with refillMs', () => {
        it('default refillMs is 1000ms, backwards compatible (9.3a.1)', () => {
            const algo = tokenBucket({ refillRate: 10 });
            expect(algo.config).toHaveProperty('refillMs', 1000);

            // Exhaust 10 tokens, wait 100ms, 1 token refills
            let state: unknown;
            for (let i = 0; i < 10; i++) {
                const { next } = algo.consume(state, 10, 5000);
                state = next;
            }
            const { result } = algo.consume(state, 10, 5100);
            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(0); // 1 refilled, 1 consumed
        });

        it('slow refill: refillMs=30000 with refillRate=10 (9.3a.2)', () => {
            // tokensPerMs = 10 / 30_000
            const algo = tokenBucket({ refillRate: 10, refillMs: 30_000 });

            let state: unknown;
            for (let i = 0; i < 10; i++) {
                const { next } = algo.consume(state, 10, 5000);
                state = next;
            }

            // Wait 3000ms: refilled = 3000 * (10/30_000) = 1
            const { result } = algo.consume(state, 10, 8000);
            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(0); // 1 refilled, 1 consumed
        });

        it('fast refill: refillMs=500 with refillRate=5 equals 10 tokens/sec (9.3a.3)', () => {
            // tokensPerMs = 5 / 500 = 0.01 (same as refillRate=10 with default refillMs)
            const algo = tokenBucket({ refillRate: 5, refillMs: 500 });

            let state: unknown;
            for (let i = 0; i < 10; i++) {
                const { next } = algo.consume(state, 10, 5000);
                state = next;
            }

            // Wait 100ms: refilled = 100 * (5/500) = 1
            const { result } = algo.consume(state, 10, 5100);
            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('refill correctness with non-default refillMs (9.3a.4)', () => {
            // 60 tokens per 60_000ms = 1 token/sec
            const algo = tokenBucket({ refillRate: 60, refillMs: 60_000 });

            let state: unknown;
            for (let i = 0; i < 10; i++) {
                const { next } = algo.consume(state, 10, 5000);
                state = next;
            }

            // Wait 1000ms: refilled = 1000 * (60/60_000) = 1
            const { result } = algo.consume(state, 10, 6000);
            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('retryAfterMs correctness with refillMs (9.3a.5)', () => {
            // tokensPerMs = 10 / 30_000
            const algo = tokenBucket({ refillRate: 10, refillMs: 30_000 });

            let state: unknown;
            for (let i = 0; i < 5; i++) {
                const { next } = algo.consume(state, 5, 5000);
                state = next;
            }

            const { result } = algo.consume(state, 5, 5000);
            expect(result.limited).toBe(true);
            // retryAfterMs = ceil(1 / (10/30_000)) = ceil(3000) = 3000
            expect(result.retryAfterMs).toBe(3000);
        });

        it('header w= correctness with refillMs (9.3a.6)', async () => {
            const limiter = rateLimit({
                limit: 100,
                algorithm: { type: 'token-bucket', refillRate: 10, refillMs: 30_000 }
            });
            const result = await limiter(createRequest());

            // w = ceil(100 / (10/30_000) / 1000) = ceil(300_000 / 1000) = 300
            expect(result.headers['RateLimit-Policy']).toBe('100;w=300');
        });

        it('refillMs with bucketSize (9.3a.7)', () => {
            const algo = tokenBucket({ refillRate: 10, refillMs: 2000, bucketSize: 20 });

            // Capacity is 20 (not limit)
            const { result } = algo.consume(undefined, 100, 5000);
            expect(result.remaining).toBe(19); // bucketSize(20) - 1

            // ttlMs = ceil(20 / (10/2000)) = ceil(20 / 0.005) = 4000
            expect(algo.ttlMs(100)).toBe(4000);
        });

        it('validation: refillMs=0 throws RangeError (9.3a.8)', () => {
            expect(() => {
                rateLimit({ limit: 10, algorithm: { type: 'token-bucket', refillRate: 10, refillMs: 0 } });
            }).toThrow(RangeError);
        });

        it('validation: refillMs negative throws RangeError (9.3a.9)', () => {
            expect(() => {
                rateLimit({ limit: 10, algorithm: { type: 'token-bucket', refillRate: 10, refillMs: -1000 } });
            }).toThrow(RangeError);
        });

        it('algo.config includes refillMs when provided (9.3a.11)', () => {
            const algo = tokenBucket({ refillRate: 10, refillMs: 5000 });
            expect(algo.config).toEqual({ refillRate: 10, refillMs: 5000 });
        });

        it('algo.config includes default refillMs when omitted (9.3a.12)', () => {
            const algo = tokenBucket({ refillRate: 10 });
            expect(algo.config).toHaveProperty('refillRate', 10);
            expect(algo.config).toHaveProperty('refillMs', 1000);
        });
    });
});
