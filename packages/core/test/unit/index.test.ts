import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rateLimit, MemoryStore, buildRateLimitResponse } from '../../src/index.js';
import type { Store, RateLimitResult } from '../../src/index.js';

function createRequest(ip = '1.2.3.4', path = '/'): Request {
    return new Request(`http://localhost${path}`, {
        headers: { 'x-forwarded-for': ip }
    });
}

describe('rateLimit', () => {
    describe('fixed window', () => {
        it('allows requests under the limit', async () => {
            const limiter = rateLimit({ limit: 3, windowMs: 60_000 });
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
            const limiter = rateLimit({ limit: 2, windowMs: 60_000 });
            const req = createRequest();

            await limiter(req);
            await limiter(req);
            const r3 = await limiter(req);

            expect(r3.limited).toBe(true);
            expect(r3.remaining).toBe(0);
        });

        it('tracks different keys separately', async () => {
            const limiter = rateLimit({ limit: 1, windowMs: 60_000 });

            const r1 = await limiter(createRequest('1.1.1.1'));
            const r2 = await limiter(createRequest('2.2.2.2'));

            expect(r1.limited).toBe(false);
            expect(r2.limited).toBe(false);
        });

        it('resets after window expires', async () => {
            vi.useFakeTimers();
            try {
                const limiter = rateLimit({ limit: 1, windowMs: 1000, algorithm: 'fixed-window' });
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
                const limiter = rateLimit({ limit: 10, windowMs: 1000, algorithm: 'sliding-window' });
                const req = createRequest();

                // Fill up 8 hits in the first window
                for (let i = 0; i < 8; i++) {
                    await limiter(req);
                }

                // Move halfway through the next window
                vi.advanceTimersByTime(1500);

                // At 50% through new window, previous weight = 0.5
                // Weighted count = 8 * 0.5 + 1 = 5 (not limited since < 10)
                const result = await limiter(req);
                expect(result.limited).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it('blocks when weighted count exceeds limit', async () => {
            vi.useFakeTimers();
            try {
                // Align to a clean second boundary for deterministic window alignment
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 10, windowMs: 1000, algorithm: 'sliding-window' });
                const req = createRequest();

                // Fill exactly at the limit in window 1
                for (let i = 0; i < 10; i++) {
                    const r = await limiter(req);
                    expect(r.limited).toBe(false);
                }

                // Advance just past the window boundary (1ms into window 2)
                // Previous weight ≈ 0.999, totalHits = ceil(10 * 0.999 + 1) = 11 > 10
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
                const limiter = rateLimit({ limit: 100, windowMs: 1000, algorithm: 'sliding-window' });

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
                const limiter = rateLimit({ limit: 10, windowMs: 1000, algorithm: 'sliding-window' });
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
                const limiter = rateLimit({ limit: 10, windowMs: 1000, algorithm: 'sliding-window' });
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
                const limiter = rateLimit({ limit: 10, windowMs: 60_000, algorithm: 'sliding-window' });
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
                const limiter = rateLimit({ limit: 10, windowMs: 1000, algorithm: 'sliding-window' });
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

        it('resetTime aligns to window boundary', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 10, windowMs: 1000, algorithm: 'sliding-window' });
                const req = createRequest();

                const result = await limiter(req);
                // resetTime should be at the end of the current aligned window
                expect(result.resetTime.getTime()).toBe(new Date('2025-01-01T00:00:01.000Z').getTime());
            } finally {
                vi.useRealTimers();
            }
        });

        it('transitions from limited to allowed as weight decays', async () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
                const limiter = rateLimit({ limit: 10, windowMs: 1000, algorithm: 'sliding-window' });
                const req = createRequest();

                // Fill exactly at limit
                for (let i = 0; i < 10; i++) {
                    await limiter(req);
                }

                // 50ms into window 2: weight = 0.95
                // ceil(10 * 0.95 + 1) = ceil(10.5) = 11 → limited
                vi.advanceTimersByTime(1050);
                const r1 = await limiter(req);
                expect(r1.limited).toBe(true);

                // 249ms into window 2 (199ms more): weight = 0.751
                // currentHits = 2 (r1 + this), ceil(10 * 0.751 + 2) = ceil(9.51) = 10 → not limited
                vi.advanceTimersByTime(199);
                const r2 = await limiter(req);
                expect(r2.limited).toBe(false);
                expect(r2.remaining).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('options', () => {
        it('uses custom keyGenerator', async () => {
            const limiter = rateLimit({
                limit: 1,
                windowMs: 60_000,
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
                windowMs: 60_000
            });

            const req = createRequest();
            const r1 = await limiter(req);
            expect(r1.limit).toBe(2);
            expect(r1.remaining).toBe(1);
        });

        it('respects skip function', async () => {
            const limiter = rateLimit({
                limit: 1,
                windowMs: 60_000,
                skip: (req: Request) => req.url.includes('/health')
            });

            const healthReq = createRequest('1.2.3.4', '/health');
            const normalReq = createRequest();

            const r1 = await limiter(healthReq);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(1); // Full limit since skipped

            // Normal request should still have full limit since health was skipped
            const r2 = await limiter(normalReq);
            expect(r2.limited).toBe(false);
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

        it('passOnStoreError allows requests when store fails', async () => {
            const failingStore: Store = {
                increment: async () => {
                    throw new Error('Store down');
                },
                decrement: async () => {},
                resetKey: async () => {},
                resetAll: async () => {}
            };

            const limiter = rateLimit({
                limit: 1,
                windowMs: 60_000,
                store: failingStore,
                passOnStoreError: true
            });

            const result = await limiter(createRequest());
            expect(result.limited).toBe(false);
        });

        it('throws when store fails and passOnStoreError is false', async () => {
            const failingStore: Store = {
                increment: async () => {
                    throw new Error('Store down');
                },
                decrement: async () => {},
                resetKey: async () => {},
                resetAll: async () => {}
            };

            const limiter = rateLimit({
                limit: 1,
                windowMs: 60_000,
                store: failingStore,
                passOnStoreError: false
            });

            await expect(limiter(createRequest())).rejects.toThrow('Rate limit store error');
        });
    });

    describe('headers', () => {
        it('generates draft-7 headers by default', async () => {
            const limiter = rateLimit({ limit: 10, windowMs: 60_000 });
            const result = await limiter(createRequest());

            expect(result.headers).toHaveProperty('RateLimit');
            expect(result.headers).toHaveProperty('RateLimit-Policy');
            expect(result.headers['RateLimit']).toMatch(/limit=10, remaining=9, reset=\d+/);
            expect(result.headers['RateLimit-Policy']).toBe('10;w=60');
        });

        it('generates draft-6 headers when configured', async () => {
            const limiter = rateLimit({ limit: 10, windowMs: 60_000, headers: 'draft-6' });
            const result = await limiter(createRequest());

            expect(result.headers).toHaveProperty('RateLimit-Limit');
            expect(result.headers).toHaveProperty('RateLimit-Remaining');
            expect(result.headers).toHaveProperty('RateLimit-Reset');
            expect(result.headers['RateLimit-Limit']).toBe('10');
            expect(result.headers['RateLimit-Remaining']).toBe('9');
        });

        it('includes legacy X-RateLimit headers when legacyHeaders is true', async () => {
            const limiter = rateLimit({ limit: 10, windowMs: 60_000, legacyHeaders: true });
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
            const limiter = rateLimit({ limit: 10, windowMs: 60_000, headers: 'draft-6', legacyHeaders: true });
            const result = await limiter(createRequest());

            // Standard draft-6 headers
            expect(result.headers['RateLimit-Limit']).toBe('10');
            expect(result.headers['RateLimit-Remaining']).toBe('9');
            // Legacy headers
            expect(result.headers['X-RateLimit-Limit']).toBe('10');
            expect(result.headers['X-RateLimit-Remaining']).toBe('9');
        });

        it('does not include legacy headers by default', async () => {
            const limiter = rateLimit({ limit: 10, windowMs: 60_000 });
            const result = await limiter(createRequest());

            expect(result.headers).not.toHaveProperty('X-RateLimit-Limit');
        });

        it('includes Retry-After header when rate-limited', async () => {
            const limiter = rateLimit({ limit: 1, windowMs: 60_000 });
            const req = createRequest();

            await limiter(req);
            const limited = await limiter(req);

            expect(limited.limited).toBe(true);
            expect(limited.headers).toHaveProperty('Retry-After');
            expect(limited.headers['Retry-After']).toMatch(/^\d+$/);
        });

        it('does not include Retry-After header when not rate-limited', async () => {
            const limiter = rateLimit({ limit: 10, windowMs: 60_000 });
            const result = await limiter(createRequest());

            expect(result.limited).toBe(false);
            expect(result.headers).not.toHaveProperty('Retry-After');
        });

        it('includes Retry-After header with draft-6 headers', async () => {
            const limiter = rateLimit({ limit: 1, windowMs: 60_000, headers: 'draft-6' });
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
            const limiter = rateLimit({ limit: 1, windowMs: 60_000 });

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
            const limiter = rateLimit({ limit: 1, windowMs: 60_000 });
            const req = new Request('http://localhost/');

            const result = await limiter(req);
            expect(result.limited).toBe(false);

            const result2 = await limiter(req);
            expect(result2.limited).toBe(true);
        });
    });
});

describe('MemoryStore', () => {
    let store: MemoryStore;

    beforeEach(() => {
        store = new MemoryStore(60_000);
    });

    afterEach(() => {
        store.shutdown();
    });

    it('increments and returns hit count', () => {
        const r1 = store.increment('key1');
        expect(r1.currentHits).toBe(1);

        const r2 = store.increment('key1');
        expect(r2.currentHits).toBe(2);
    });

    it('decrements hit count', () => {
        store.increment('key1');
        store.increment('key1');
        store.decrement('key1');

        // start=0, inc->1, inc->2, dec->1, inc->2
        const result = store.increment('key1');
        expect(result.currentHits).toBe(2);
    });

    it('resets a specific key', () => {
        store.increment('key1');
        store.increment('key1');
        store.resetKey('key1');

        const result = store.increment('key1');
        expect(result.currentHits).toBe(1);
    });

    it('resets all keys', () => {
        store.increment('key1');
        store.increment('key2');
        store.resetAll();

        const r1 = store.increment('key1');
        const r2 = store.increment('key2');
        expect(r1.currentHits).toBe(1);
        expect(r2.currentHits).toBe(1);
    });

    it('returns a reset time in the future', () => {
        const result = store.increment('key1');
        expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
    });
});
