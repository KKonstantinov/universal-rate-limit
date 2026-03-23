import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisStore } from '../../src/index.js';
import { rateLimit, fixedWindow, slidingWindow, tokenBucket } from 'universal-rate-limit';
import type { Algorithm } from 'universal-rate-limit';
import type { RedisTestContext } from './redis-container.js';
import { startRedisContainer, stopRedisContainer } from './redis-container.js';

describe('RedisStore integration', () => {
    let ctx: RedisTestContext;

    beforeAll(async () => {
        ctx = await startRedisContainer();
    }, 60_000);

    afterAll(async () => {
        await stopRedisContainer(ctx);
    });

    function createStore(options?: { prefix?: string }) {
        const uniquePrefix = options?.prefix ?? `test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}:`;
        return new RedisStore({
            sendCommand: ctx.sendCommand,
            prefix: uniquePrefix
        });
    }

    // ── Fixed Window: Basic Operations ───────────────────────────────────

    describe('fixed-window algorithm', () => {
        const algo = fixedWindow({ windowMs: 60_000 });

        it('consume first call returns remaining = limit - 1', async () => {
            const store = createStore();
            const result = await store.consume('key', algo, 10);

            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(9);
            expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
            expect(result.retryAfterMs).toBe(0);
        });

        it('consume subsequent calls decrement remaining', async () => {
            const store = createStore();

            const r1 = await store.consume('key', algo, 10);
            const r2 = await store.consume('key', algo, 10);
            const r3 = await store.consume('key', algo, 10);

            expect(r1.remaining).toBe(9);
            expect(r2.remaining).toBe(8);
            expect(r3.remaining).toBe(7);
        });

        it('blocks when limit exceeded', async () => {
            const store = createStore();

            for (let i = 0; i < 3; i++) {
                const r = await store.consume('key', algo, 3);
                expect(r.limited).toBe(false);
            }

            const limited = await store.consume('key', algo, 3);
            expect(limited.limited).toBe(true);
            expect(limited.remaining).toBe(0);
            expect(limited.retryAfterMs).toBeGreaterThan(0);
        });

        it('peek returns current state without modifying', async () => {
            const store = createStore();

            await store.consume('key', algo, 10);
            await store.consume('key', algo, 10);

            const peeked = await store.peek('key', algo, 10);
            expect(peeked).toBeDefined();
            expect(peeked!.remaining).toBe(8);

            // Consume after peek should show remaining = 7, not 6
            const r3 = await store.consume('key', algo, 10);
            expect(r3.remaining).toBe(7);
        });

        it('peek returns undefined for non-existent key', async () => {
            const store = createStore();
            const result = await store.peek('nonexistent', algo, 10);
            expect(result).toBeUndefined();
        });

        it('key expires after windowMs', async () => {
            const shortAlgo = fixedWindow({ windowMs: 2000 });
            const store = createStore();

            const r1 = await store.consume('key', shortAlgo, 10);
            expect(r1.remaining).toBe(9);

            await new Promise(resolve => setTimeout(resolve, 2500));

            const r2 = await store.consume('key', shortAlgo, 10);
            expect(r2.remaining).toBe(9);
        });
    });

    // ── Sliding Window ───────────────────────────────────────────────────

    describe('sliding-window algorithm', () => {
        const algo = slidingWindow({ windowMs: 60_000 });

        it('consume first call returns remaining = limit - 1', async () => {
            const store = createStore();
            const result = await store.consume('key', algo, 10);

            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(9);
            expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
        });

        it('blocks when limit exceeded', async () => {
            const store = createStore();

            for (let i = 0; i < 10; i++) {
                const r = await store.consume('key', algo, 10);
                expect(r.limited).toBe(false);
            }

            const limited = await store.consume('key', algo, 10);
            expect(limited.limited).toBe(true);
            expect(limited.remaining).toBe(0);
        });

        it('weighted counting from previous window', async () => {
            const shortAlgo = slidingWindow({ windowMs: 2000 });
            const store = createStore();

            // Fill 8 hits
            for (let i = 0; i < 8; i++) {
                await store.consume('key', shortAlgo, 10);
            }

            // Wait for window to expire, then send a request ~halfway into window 2
            // At 50% through new window, weight ~ 0.5
            // totalHits = ceil(8 * 0.5 + 1) = ceil(5) = 5, remaining ~ 5
            await new Promise(resolve => setTimeout(resolve, 3000));

            const result = await store.consume('key', shortAlgo, 10);
            expect(result.limited).toBe(false);
            // Due to timing imprecision with real Redis, we allow some tolerance
            expect(result.remaining).toBeGreaterThanOrEqual(1);
            expect(result.remaining).toBeLessThanOrEqual(9);
        });
    });

    // ── Token Bucket ─────────────────────────────────────────────────────

    describe('token-bucket algorithm', () => {
        const algo = tokenBucket({ refillRate: 10 });

        it('consume first call returns remaining = limit - 1', async () => {
            const store = createStore();
            const result = await store.consume('key', algo, 10);

            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(9);
        });

        it('allows requests under capacity', async () => {
            const store = createStore();

            for (let i = 0; i < 10; i++) {
                const r = await store.consume('key', algo, 10);
                expect(r.limited).toBe(false);
                expect(r.remaining).toBe(10 - 1 - i);
            }
        });

        it('blocks when exhausted', async () => {
            const store = createStore();

            for (let i = 0; i < 10; i++) {
                await store.consume('key', algo, 10);
            }

            const limited = await store.consume('key', algo, 10);
            expect(limited.limited).toBe(true);
            expect(limited.remaining).toBe(0);
            expect(limited.retryAfterMs).toBeGreaterThan(0);
        });

        it('refills over time', async () => {
            const store = createStore();

            // Exhaust all 10 tokens
            for (let i = 0; i < 10; i++) {
                await store.consume('key', algo, 10);
            }

            // With refillRate=10, 1 second = 10 tokens. Wait 500ms for ~5 tokens.
            await new Promise(resolve => setTimeout(resolve, 500));

            const result = await store.consume('key', algo, 10);
            expect(result.limited).toBe(false);
            // Should have refilled some tokens
            expect(result.remaining).toBeGreaterThanOrEqual(1);
        });

        it('tokens cap at limit', async () => {
            const store = createStore();

            // Send 1 request
            await store.consume('key', algo, 10);

            // Wait a long time (much more than needed to refill)
            await new Promise(resolve => setTimeout(resolve, 2000));

            const result = await store.consume('key', algo, 10);
            expect(result.limited).toBe(false);
            // Should be capped at limit - 1 (bucket full, minus this request)
            expect(result.remaining).toBe(9);
        });

        it('retryAfterMs correctness when exhausted', async () => {
            const store = createStore();

            // Exhaust all tokens
            for (let i = 0; i < 10; i++) {
                await store.consume('key', algo, 10);
            }

            const limited = await store.consume('key', algo, 10);
            expect(limited.limited).toBe(true);
            // retryAfterMs should be ceil(1/10 * 1000) = 100ms
            expect(limited.retryAfterMs).toBeGreaterThan(0);
            expect(limited.retryAfterMs).toBeLessThanOrEqual(200);
        });

        it('wait retryAfterMs then unblocked', async () => {
            // refillRate=2 means 2 tokens/sec; limit=2
            const fastAlgo = tokenBucket({ refillRate: 2 });
            const store = createStore();

            // Exhaust both tokens
            await store.consume('key', fastAlgo, 2);
            await store.consume('key', fastAlgo, 2);

            const limited = await store.consume('key', fastAlgo, 2);
            expect(limited.limited).toBe(true);
            expect(limited.retryAfterMs).toBeGreaterThan(0);

            // Wait the retryAfterMs + margin
            await new Promise(resolve => setTimeout(resolve, limited.retryAfterMs + 200));

            const result = await store.consume('key', fastAlgo, 2);
            expect(result.limited).toBe(false);
        });

        it('mid-refill remains limited', async () => {
            // refillRate=1 means 1 token/sec; limit=5
            const slowAlgo = tokenBucket({ refillRate: 1 });
            const store = createStore();

            // Exhaust all 5 tokens
            for (let i = 0; i < 5; i++) {
                await store.consume('key', slowAlgo, 5);
            }

            const limited = await store.consume('key', slowAlgo, 5);
            expect(limited.limited).toBe(true);

            // Wait 200ms — only 0.2 tokens at 1 token/sec, not enough
            await new Promise(resolve => setTimeout(resolve, 200));

            const stillLimited = await store.consume('key', slowAlgo, 5);
            expect(stillLimited.limited).toBe(true);
        });

        it('non-default refillMs slows refill rate', async () => {
            // refillRate=10, refillMs=30_000 → tokensPerMs = 10/30000 ≈ 0.000333
            // 500ms wait → refilled = 500 * 0.000333 ≈ 0.167 tokens (not enough for 1 request)
            const slowAlgo = tokenBucket({ refillRate: 10, refillMs: 30_000 });
            const store = createStore();

            // Exhaust all 5 tokens
            for (let i = 0; i < 5; i++) {
                await store.consume('key', slowAlgo, 5);
            }

            // Wait 500ms — with default refillMs=1000 this would refill 5 tokens,
            // but with refillMs=30_000 it only refills ~0.167 tokens
            await new Promise(resolve => setTimeout(resolve, 500));

            const result = await store.consume('key', slowAlgo, 5);
            expect(result.limited).toBe(true);
            expect(result.remaining).toBe(0);
        });
    });

    // ── Unknown Algorithm ────────────────────────────────────────────────

    it('throws on unknown algorithm name', async () => {
        const store = createStore();
        const unknownAlgo: Algorithm = {
            name: 'unknown-algo',
            config: {},
            consume: () => ({ next: {}, result: { limited: false, remaining: 0, resetTime: new Date(), retryAfterMs: 0 } }),
            ttlMs: () => 60_000
        };

        await expect(store.consume('key', unknownAlgo, 10)).rejects.toThrow(/unsupported|unknown/i);
    });

    // ── resetKey / resetAll ──────────────────────────────────────────────

    describe('key management', () => {
        it('resetKey clears a specific key', async () => {
            const algo = fixedWindow({ windowMs: 60_000 });
            const store = createStore();

            await store.consume('key', algo, 10);
            await store.consume('key', algo, 10);
            await store.resetKey('key');

            const result = await store.consume('key', algo, 10);
            expect(result.remaining).toBe(9);
        });

        it('resetAll clears all keys with the prefix', async () => {
            const algo = fixedWindow({ windowMs: 60_000 });
            const store = createStore();

            await store.consume('key-a', algo, 10);
            await store.consume('key-b', algo, 10);
            await store.consume('key-c', algo, 10);

            await store.resetAll();

            const pA = await store.peek('key-a', algo, 10);
            const pB = await store.peek('key-b', algo, 10);
            const pC = await store.peek('key-c', algo, 10);
            expect(pA).toBeUndefined();
            expect(pB).toBeUndefined();
            expect(pC).toBeUndefined();
        });

        it('resetAll paginates through SCAN cursor for large key sets', async () => {
            const algo = fixedWindow({ windowMs: 60_000 });
            const store = createStore();
            const keyCount = 250;

            await Promise.all(Array.from({ length: keyCount }, (_, i) => store.consume(`key-${String(i)}`, algo, 10)));

            await store.resetAll();

            for (const i of [0, 49, 99, 149, 199, 249]) {
                expect(await store.peek(`key-${String(i)}`, algo, 10)).toBeUndefined();
            }
        });
    });

    // ── Lua Script Behavior ──────────────────────────────────────────────

    describe('Lua script resilience', () => {
        it('recovers from NOSCRIPT after SCRIPT FLUSH', async () => {
            const algo = fixedWindow({ windowMs: 60_000 });
            const store = createStore();

            // Load scripts into cache
            await store.consume('key', algo, 10);

            // Flush the Redis script cache
            await ctx.client.sendCommand(['SCRIPT', 'FLUSH']);

            // Should recover via EVAL fallback
            const result = await store.consume('key', algo, 10);
            expect(result.remaining).toBe(8);
        });

        it('atomic consume under concurrency', async () => {
            const algo = fixedWindow({ windowMs: 60_000 });
            const store = createStore();
            const concurrency = 50;

            const results = await Promise.all(Array.from({ length: concurrency }, () => store.consume('key', algo, 1000)));

            // Every result should have a unique remaining value
            const remainings = results.map(r => r.remaining);
            remainings.sort((a, b) => a - b);
            // Remaining should go from 950..999 (1000 - 50 .. 1000 - 1)
            expect(remainings[0]).toBe(1000 - concurrency);
            expect(remainings[concurrency - 1]).toBe(999);

            // All should be unique
            const unique = new Set(remainings);
            expect(unique.size).toBe(concurrency);
        });
    });

    // ── Integration with Core rateLimit() ────────────────────────────────

    describe('rateLimit() with RedisStore', () => {
        it('enforces limit with fixed-window', async () => {
            const store = createStore();
            const limiter = rateLimit({
                limit: 3,
                algorithm: { type: 'fixed-window', windowMs: 60_000 },
                store
            });

            const request = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.1' }
            });

            const r1 = await limiter(request);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(2);

            const r2 = await limiter(request);
            expect(r2.limited).toBe(false);
            expect(r2.remaining).toBe(1);

            const r3 = await limiter(request);
            expect(r3.limited).toBe(false);
            expect(r3.remaining).toBe(0);

            const r4 = await limiter(request);
            expect(r4.limited).toBe(true);
            expect(r4.remaining).toBe(0);
        });

        it('enforces limit with sliding-window (default)', async () => {
            const store = createStore();
            const limiter = rateLimit({
                windowMs: 60_000,
                limit: 3,
                store
            });

            const request = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.2' }
            });

            const r1 = await limiter(request);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(2);

            const r2 = await limiter(request);
            expect(r2.limited).toBe(false);
            expect(r2.remaining).toBe(1);

            const r3 = await limiter(request);
            expect(r3.limited).toBe(false);
            expect(r3.remaining).toBe(0);

            const r4 = await limiter(request);
            expect(r4.limited).toBe(true);
            expect(r4.remaining).toBe(0);
        });

        it('enforces limit with token-bucket', async () => {
            const store = createStore();
            const limiter = rateLimit({
                limit: 3,
                algorithm: { type: 'token-bucket', refillRate: 10 },
                store
            });

            const request = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.3' }
            });

            const r1 = await limiter(request);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(2);

            const r2 = await limiter(request);
            expect(r2.limited).toBe(false);
            expect(r2.remaining).toBe(1);

            const r3 = await limiter(request);
            expect(r3.limited).toBe(false);
            expect(r3.remaining).toBe(0);

            const r4 = await limiter(request);
            expect(r4.limited).toBe(true);
            expect(r4.remaining).toBe(0);
        });

        it('different IPs get independent counters', async () => {
            const store = createStore();
            const limiter = rateLimit({
                limit: 2,
                algorithm: { type: 'fixed-window', windowMs: 60_000 },
                store
            });

            const reqA = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.1' }
            });
            const reqB = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.2' }
            });

            await limiter(reqA);
            await limiter(reqA);
            const r3 = await limiter(reqA);
            expect(r3.limited).toBe(true);

            const rB = await limiter(reqB);
            expect(rB.limited).toBe(false);
            expect(rB.remaining).toBe(1);
        });

        it('fixed-window Retry-After: wait then unblocked', async () => {
            const store = createStore();
            const limiter = rateLimit({
                limit: 2,
                algorithm: { type: 'fixed-window', windowMs: 2000 },
                store,
                headers: 'draft-7'
            });

            const request = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.50' }
            });

            await limiter(request);
            await limiter(request);

            const blocked = await limiter(request);
            expect(blocked.limited).toBe(true);
            const retryAfterSeconds = Number(blocked.headers['Retry-After']);
            expect(retryAfterSeconds).toBeGreaterThan(0);

            await new Promise(resolve => setTimeout(resolve, retryAfterSeconds * 1000 + 200));

            const unblocked = await limiter(request);
            expect(unblocked.limited).toBe(false);
        });

        it('sliding-window Retry-After: wait then unblocked', async () => {
            const store = createStore();
            const limiter = rateLimit({
                limit: 2,
                algorithm: { type: 'sliding-window', windowMs: 3000 },
                store,
                headers: 'draft-7'
            });

            const request = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.51' }
            });

            await limiter(request);
            await limiter(request);

            const blocked = await limiter(request);
            expect(blocked.limited).toBe(true);
            const retryAfterSeconds = Number(blocked.headers['Retry-After']);
            expect(retryAfterSeconds).toBeGreaterThan(0);

            await new Promise(resolve => setTimeout(resolve, retryAfterSeconds * 1000 + 500));

            const unblocked = await limiter(request);
            expect(unblocked.limited).toBe(false);
        });

        it('token-bucket Retry-After: wait then unblocked', async () => {
            const store = createStore();
            const limiter = rateLimit({
                limit: 2,
                algorithm: { type: 'token-bucket', refillRate: 2 },
                store,
                headers: 'draft-7'
            });

            const request = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.52' }
            });

            await limiter(request);
            await limiter(request);

            const blocked = await limiter(request);
            expect(blocked.limited).toBe(true);
            const retryAfterSeconds = Number(blocked.headers['Retry-After']);
            expect(retryAfterSeconds).toBeGreaterThan(0);

            await new Promise(resolve => setTimeout(resolve, retryAfterSeconds * 1000 + 200));

            const unblocked = await limiter(request);
            expect(unblocked.limited).toBe(false);
        });

        it('generates correct headers with token-bucket', async () => {
            const store = createStore();
            const limiter = rateLimit({
                limit: 10,
                algorithm: { type: 'token-bucket', refillRate: 5 },
                store
            });

            const request = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.4' }
            });

            const result = await limiter(request);
            expect(result.headers).toHaveProperty('RateLimit');
            expect(result.headers).toHaveProperty('RateLimit-Policy');
            expect(result.headers['RateLimit']).toMatch(/limit=10, remaining=9, reset=\d+/);
            // w= should be ceil(limit / refillRate) = ceil(10/5) = 2
            expect(result.headers['RateLimit-Policy']).toBe('10;w=2');
        });
    });

    // ── Prefix Isolation ─────────────────────────────────────────────────

    describe('prefix isolation', () => {
        it('custom prefix isolates keys between stores', async () => {
            const algo = fixedWindow({ windowMs: 60_000 });
            const suffix = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
            const storeA = createStore({ prefix: `a-${suffix}:` });
            const storeB = createStore({ prefix: `b-${suffix}:` });

            await storeA.consume('key', algo, 10);
            await storeA.consume('key', algo, 10);
            await storeB.consume('key', algo, 10);

            const resultA = await storeA.peek('key', algo, 10);
            const resultB = await storeB.peek('key', algo, 10);

            expect(resultA!.remaining).toBe(8);
            expect(resultB!.remaining).toBe(9);
        });

        it('resetAll only clears own prefix', async () => {
            const algo = fixedWindow({ windowMs: 60_000 });
            const suffix = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
            const storeA = createStore({ prefix: `a-${suffix}:` });
            const storeB = createStore({ prefix: `b-${suffix}:` });

            await storeA.consume('key', algo, 10);
            await storeB.consume('key', algo, 10);

            await storeA.resetAll();

            expect(await storeA.peek('key', algo, 10)).toBeUndefined();
            const resultB = await storeB.peek('key', algo, 10);
            expect(resultB).toBeDefined();
            expect(resultB!.remaining).toBe(9);
        });
    });
});
