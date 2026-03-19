import { describe, it, expect, afterEach } from 'vitest';
import { rateLimit, MemoryStore } from '../../src/index.js';

function createRequest(ip = '1.2.3.4'): Request {
    return new Request('http://localhost/', {
        headers: { 'x-forwarded-for': ip }
    });
}

describe('Shared store between limiters', () => {
    let store: MemoryStore;

    afterEach(() => {
        store.shutdown();
    });

    it('two limiters sharing a store count against the same key', async () => {
        store = new MemoryStore(60_000, 'fixed-window');

        const limiterA = rateLimit({ limit: 3, windowMs: 60_000, store });
        const limiterB = rateLimit({ limit: 3, windowMs: 60_000, store });

        const req = createRequest('10.0.0.1');

        // 2 hits through limiter A
        await limiterA(req);
        await limiterA(req);

        // 1 hit through limiter B — should be the 3rd hit on the same key
        const r3 = await limiterB(req);
        expect(r3.limited).toBe(false);
        expect(r3.remaining).toBe(0);

        // 4th hit through limiter B — should be limited
        const r4 = await limiterB(req);
        expect(r4.limited).toBe(true);
    });

    it('resetKey affects all limiters using that store', async () => {
        store = new MemoryStore(60_000, 'fixed-window');

        const limiterA = rateLimit({ limit: 1, windowMs: 60_000, store });
        const limiterB = rateLimit({ limit: 1, windowMs: 60_000, store });

        const req = createRequest('10.0.0.1');

        // Exhaust through limiter A
        await limiterA(req);
        const r2 = await limiterB(req);
        expect(r2.limited).toBe(true);

        // Reset the key via the shared store
        store.resetKey('10.0.0.1');

        // Both limiters should allow requests again
        const r3 = await limiterA(req);
        expect(r3.limited).toBe(false);
    });

    it('resetAll clears everything across both limiters', async () => {
        store = new MemoryStore(60_000, 'fixed-window');

        const limiterA = rateLimit({ limit: 1, windowMs: 60_000, store });
        const limiterB = rateLimit({ limit: 1, windowMs: 60_000, store });

        const reqA = createRequest('10.0.0.1');
        const reqB = createRequest('10.0.0.2');

        // Exhaust both keys
        await limiterA(reqA);
        await limiterB(reqB);

        const r1 = await limiterA(reqA);
        const r2 = await limiterB(reqB);
        expect(r1.limited).toBe(true);
        expect(r2.limited).toBe(true);

        // Reset all
        store.resetAll();

        // Both keys should be cleared
        const r3 = await limiterA(reqA);
        const r4 = await limiterB(reqB);
        expect(r3.limited).toBe(false);
        expect(r4.limited).toBe(false);
    });
});
