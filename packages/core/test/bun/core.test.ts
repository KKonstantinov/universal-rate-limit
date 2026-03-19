import { describe, it, expect } from 'bun:test';
import { rateLimit, MemoryStore } from '../../dist/index.mjs';

function createRequest(ip = '1.2.3.4', path = '/'): Request {
    return new Request(`http://localhost${path}`, {
        headers: { 'x-forwarded-for': ip }
    });
}

describe('rateLimit core (Bun)', () => {
    it('allows requests under the limit and blocks over it', async () => {
        const limiter = rateLimit({ limit: 2, windowMs: 60_000 });
        const req = createRequest();

        const r1 = await limiter(req);
        expect(r1.limited).toBe(false);
        expect(r1.remaining).toBe(1);

        const r2 = await limiter(req);
        expect(r2.limited).toBe(false);
        expect(r2.remaining).toBe(0);

        const r3 = await limiter(req);
        expect(r3.limited).toBe(true);
        expect(r3.remaining).toBe(0);
    });

    it('custom keyGenerator via Request.headers.get()', async () => {
        const limiter = rateLimit({
            limit: 1,
            windowMs: 60_000,
            keyGenerator: (req: Request) => req.headers.get('x-api-key') ?? 'unknown'
        });

        const reqA = new Request('http://localhost/', { headers: { 'x-api-key': 'key-a' } });
        const reqB = new Request('http://localhost/', { headers: { 'x-api-key': 'key-b' } });

        const r1 = await limiter(reqA);
        const r2 = await limiter(reqB);
        expect(r1.limited).toBe(false);
        expect(r2.limited).toBe(false);

        const r3 = await limiter(reqA);
        expect(r3.limited).toBe(true);
    });

    it('window expiration with real timer', async () => {
        const limiter = rateLimit({ limit: 1, windowMs: 300 });
        const req = createRequest();

        const r1 = await limiter(req);
        expect(r1.limited).toBe(false);

        const r2 = await limiter(req);
        expect(r2.limited).toBe(true);

        await Bun.sleep(500);

        const r3 = await limiter(req);
        expect(r3.limited).toBe(false);
    });
});

describe('MemoryStore (Bun)', () => {
    it('increment, decrement, resetKey, resetAll', async () => {
        const store = new MemoryStore(60_000, 'fixed-window');
        try {
            const r1 = await store.increment('k1');
            expect(r1.totalHits).toBe(1);

            const r2 = await store.increment('k1');
            expect(r2.totalHits).toBe(2);

            await store.decrement('k1');
            const r3 = await store.increment('k1');
            expect(r3.totalHits).toBe(2);

            await store.resetKey('k1');
            const r4 = await store.increment('k1');
            expect(r4.totalHits).toBe(1);

            await store.increment('k2');
            await store.resetAll();
            const r5 = await store.increment('k1');
            const r6 = await store.increment('k2');
            expect(r5.totalHits).toBe(1);
            expect(r6.totalHits).toBe(1);
        } finally {
            store.shutdown();
        }
    });
});

describe('Header generation (Bun)', () => {
    it('generates draft-7 headers by default', async () => {
        const limiter = rateLimit({ limit: 10, windowMs: 60_000 });
        const result = await limiter(createRequest());

        expect(result.headers['RateLimit']).toMatch(/limit=10, remaining=9, reset=\d+/);
        expect(result.headers['RateLimit-Policy']).toBe('10;w=60');
    });

    it('generates draft-6 headers when configured', async () => {
        const limiter = rateLimit({ limit: 10, windowMs: 60_000, headers: 'draft-6' });
        const result = await limiter(createRequest());

        expect(result.headers['RateLimit-Limit']).toBe('10');
        expect(result.headers['RateLimit-Remaining']).toBe('9');
        expect(result.headers['RateLimit-Reset']).toMatch(/^\d+$/);
    });
});
