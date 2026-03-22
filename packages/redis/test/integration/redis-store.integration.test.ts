import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisStore } from '../../src/index.js';
import { rateLimit } from 'universal-rate-limit';
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

    function createStore(options?: { windowMs?: number; prefix?: string; resetExpiryOnChange?: boolean }) {
        const uniquePrefix = options?.prefix ?? `test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}:`;
        return new RedisStore({
            sendCommand: ctx.sendCommand,
            windowMs: options?.windowMs ?? 60_000,
            prefix: uniquePrefix,
            resetExpiryOnChange: options?.resetExpiryOnChange
        });
    }

    // ── Basic Operations ─────────────────────────────────────────────────

    it('increment first call returns currentHits=1', async () => {
        const store = createStore();
        const result = await store.increment('key');

        expect(result.currentHits).toBe(1);
        expect(result.previousHits).toBe(0);
        expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
    });

    it('increment subsequent calls increase counter', async () => {
        const store = createStore();

        const r1 = await store.increment('key');
        const r2 = await store.increment('key');
        const r3 = await store.increment('key');

        expect(r1.currentHits).toBe(1);
        expect(r2.currentHits).toBe(2);
        expect(r3.currentHits).toBe(3);
    });

    it('get returns current hits and TTL for existing key', async () => {
        const store = createStore();

        await store.increment('key');
        await store.increment('key');

        const result = await store.get('key');
        expect(result).toBeDefined();
        expect(result!.currentHits).toBe(2);
        expect(result!.resetTime.getTime()).toBeGreaterThan(Date.now());
    });

    it('get returns undefined for non-existent key', async () => {
        const store = createStore();
        const result = await store.get('nonexistent');
        expect(result).toBeUndefined();
    });

    it('decrement reduces counter by one', async () => {
        const store = createStore();

        await store.increment('key');
        await store.increment('key');
        await store.increment('key');
        await store.decrement('key');

        const result = await store.get('key');
        expect(result).toBeDefined();
        expect(result!.currentHits).toBe(2);
    });

    it('resetKey deletes a specific key', async () => {
        const store = createStore();

        await store.increment('key');
        await store.increment('key');
        await store.resetKey('key');

        const result = await store.increment('key');
        expect(result.currentHits).toBe(1);
    });

    it('resetAll clears all keys with the prefix', async () => {
        const store = createStore();

        await store.increment('key-a');
        await store.increment('key-b');
        await store.increment('key-c');

        await store.resetAll();

        expect(await store.get('key-a')).toBeUndefined();
        expect(await store.get('key-b')).toBeUndefined();
        expect(await store.get('key-c')).toBeUndefined();
    });

    it('resetAll paginates through SCAN cursor for large key sets', async () => {
        const store = createStore();
        const keyCount = 250;

        await Promise.all(Array.from({ length: keyCount }, (_, i) => store.increment(`key-${String(i)}`)));

        await store.resetAll();

        // Spot-check a spread of keys to confirm all were deleted
        for (const i of [0, 49, 99, 149, 199, 249]) {
            expect(await store.get(`key-${String(i)}`)).toBeUndefined();
        }
    });

    // ── TTL and Window Expiration ────────────────────────────────────────

    it('key expires after windowMs', async () => {
        const store = createStore({ windowMs: 2000 });

        const r1 = await store.increment('key');
        expect(r1.currentHits).toBe(1);

        await new Promise(resolve => setTimeout(resolve, 2500));

        const r2 = await store.increment('key');
        expect(r2.currentHits).toBe(1);
    });

    it('resetExpiryOnChange refreshes TTL on each increment', async () => {
        const store = createStore({ windowMs: 3000, resetExpiryOnChange: true });

        await store.increment('key');

        // Wait 2 seconds (within original 3s window)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // This increment should refresh the TTL
        const r2 = await store.increment('key');
        expect(r2.currentHits).toBe(2);

        // Wait another 2 seconds — should still be alive because TTL was refreshed
        await new Promise(resolve => setTimeout(resolve, 2000));

        const r3 = await store.increment('key');
        expect(r3.currentHits).toBe(3);

        // Wait the full window with no activity — should expire
        await new Promise(resolve => setTimeout(resolve, 3500));

        const r4 = await store.increment('key');
        expect(r4.currentHits).toBe(1);
    });

    // ── Lua Script Behavior ──────────────────────────────────────────────

    it('recovers from NOSCRIPT after SCRIPT FLUSH', async () => {
        const store = createStore();

        // Load scripts into cache
        await store.increment('key');

        // Flush the Redis script cache
        await ctx.client.sendCommand(['SCRIPT', 'FLUSH']);

        // Should recover via EVAL fallback
        const result = await store.increment('key');
        expect(result.currentHits).toBe(2);
    });

    it('atomic increment under concurrency', async () => {
        const store = createStore();
        const concurrency = 50;

        const results = await Promise.all(Array.from({ length: concurrency }, () => store.increment('key')));

        // Every result should have a unique currentHits from 1..50
        const hits = results.map(r => r.currentHits);
        hits.sort((a, b) => a - b);
        expect(hits).toEqual(Array.from({ length: concurrency }, (_, i) => i + 1));

        // Final count should be exactly 50
        const final = await store.get('key');
        expect(final).toBeDefined();
        expect(final!.currentHits).toBe(concurrency);
    });

    // ── Integration with Core rateLimit() ────────────────────────────────

    it('rateLimit() with RedisStore enforces limit', async () => {
        const store = createStore();
        const limiter = rateLimit({
            windowMs: 60_000,
            limit: 3,
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

    it('different IPs get independent counters', async () => {
        const store = createStore();
        const limiter = rateLimit({
            windowMs: 60_000,
            limit: 2,
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

    // ── Prefix Isolation ─────────────────────────────────────────────────

    it('custom prefix isolates keys between stores', async () => {
        const suffix = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
        const storeA = createStore({ prefix: `a-${suffix}:` });
        const storeB = createStore({ prefix: `b-${suffix}:` });

        await storeA.increment('key');
        await storeA.increment('key');
        await storeB.increment('key');

        const resultA = await storeA.get('key');
        const resultB = await storeB.get('key');

        expect(resultA!.currentHits).toBe(2);
        expect(resultB!.currentHits).toBe(1);
    });

    it('resetAll only clears own prefix', async () => {
        const suffix = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
        const storeA = createStore({ prefix: `a-${suffix}:` });
        const storeB = createStore({ prefix: `b-${suffix}:` });

        await storeA.increment('key');
        await storeB.increment('key');

        await storeA.resetAll();

        expect(await storeA.get('key')).toBeUndefined();
        const resultB = await storeB.get('key');
        expect(resultB).toBeDefined();
        expect(resultB!.currentHits).toBe(1);
    });
});
