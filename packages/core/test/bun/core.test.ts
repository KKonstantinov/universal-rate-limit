import { describe, it, expect } from 'bun:test';
import { rateLimit, MemoryStore, fixedWindow } from '../../dist/index.mjs';

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
        // Use fixed-window for a clean reset after windowMs
        const limiter = rateLimit({ limit: 1, algorithm: { type: 'fixed-window', windowMs: 300 } });
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
    it('consume, resetKey, resetAll', () => {
        const store = new MemoryStore();
        const algo = fixedWindow({ windowMs: 60_000 });
        try {
            const r1 = store.consume('k1', algo, 100);
            expect(r1.remaining).toBe(99);

            const r2 = store.consume('k1', algo, 100);
            expect(r2.remaining).toBe(98);

            store.resetKey('k1');
            const r3 = store.consume('k1', algo, 100);
            expect(r3.remaining).toBe(99);

            store.consume('k2', algo, 100);
            store.resetAll();
            const r4 = store.consume('k1', algo, 100);
            const r5 = store.consume('k2', algo, 100);
            expect(r4.remaining).toBe(99);
            expect(r5.remaining).toBe(99);
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
