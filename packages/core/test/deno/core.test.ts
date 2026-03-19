import { assertEquals, assertMatch } from 'jsr:@std/assert';
import { rateLimit, MemoryStore } from '../../dist/index.mjs';

function createRequest(ip = '1.2.3.4', path = '/'): Request {
    return new Request(`http://localhost${path}`, {
        headers: { 'x-forwarded-for': ip }
    });
}

Deno.test('rateLimit allows requests under the limit and blocks over it', async () => {
    const store = new MemoryStore(60_000, 'fixed-window');
    try {
        const limiter = rateLimit({ limit: 2, windowMs: 60_000, store });
        const req = createRequest();

        const r1 = await limiter(req);
        assertEquals(r1.limited, false);
        assertEquals(r1.remaining, 1);

        const r2 = await limiter(req);
        assertEquals(r2.limited, false);
        assertEquals(r2.remaining, 0);

        const r3 = await limiter(req);
        assertEquals(r3.limited, true);
        assertEquals(r3.remaining, 0);
    } finally {
        store.shutdown();
    }
});

Deno.test('MemoryStore operations', async () => {
    const store = new MemoryStore(60_000, 'fixed-window');
    try {
        const r1 = await store.increment('k1');
        assertEquals(r1.totalHits, 1);

        const r2 = await store.increment('k1');
        assertEquals(r2.totalHits, 2);

        await store.decrement('k1');
        const r3 = await store.increment('k1');
        assertEquals(r3.totalHits, 2);

        await store.resetKey('k1');
        const r4 = await store.increment('k1');
        assertEquals(r4.totalHits, 1);

        await store.increment('k2');
        await store.resetAll();
        const r5 = await store.increment('k1');
        const r6 = await store.increment('k2');
        assertEquals(r5.totalHits, 1);
        assertEquals(r6.totalHits, 1);
    } finally {
        store.shutdown();
    }
});

Deno.test('generates draft-7 headers by default', async () => {
    const store = new MemoryStore(60_000, 'fixed-window');
    try {
        const limiter = rateLimit({ limit: 10, windowMs: 60_000, store });
        const result = await limiter(createRequest());

        assertMatch(result.headers['RateLimit'] as string, /limit=10, remaining=9, reset=\d+/);
        assertEquals(result.headers['RateLimit-Policy'] as string, '10;w=60');
    } finally {
        store.shutdown();
    }
});

Deno.test('generates draft-6 headers when configured', async () => {
    const store = new MemoryStore(60_000, 'fixed-window');
    try {
        const limiter = rateLimit({ limit: 10, windowMs: 60_000, headers: 'draft-6', store });
        const result = await limiter(createRequest());

        assertEquals(result.headers['RateLimit-Limit'] as string, '10');
        assertEquals(result.headers['RateLimit-Remaining'] as string, '9');
        assertMatch(result.headers['RateLimit-Reset'] as string, /^\d+$/);
    } finally {
        store.shutdown();
    }
});

Deno.test('setInterval unref compatibility — timer does not block', async () => {
    // The MemoryStore constructor checks `'unref' in timer` and calls it
    // This test verifies the store can be created and shut down cleanly in Deno
    const store = new MemoryStore(1000, 'fixed-window');
    const result = await store.increment('test');
    assertEquals(result.totalHits, 1);
    store.shutdown();
});

Deno.test('window expiration with real timer', async () => {
    const store = new MemoryStore(300, 'fixed-window');
    try {
        const limiter = rateLimit({ limit: 1, windowMs: 300, store });
        const req = createRequest();

        const r1 = await limiter(req);
        assertEquals(r1.limited, false);

        const r2 = await limiter(req);
        assertEquals(r2.limited, true);

        await new Promise(resolve => setTimeout(resolve, 500));

        const r3 = await limiter(req);
        assertEquals(r3.limited, false);
    } finally {
        store.shutdown();
    }
});
