import { assertEquals } from 'jsr:@std/assert';
import { rateLimit, MemoryStore, buildRateLimitResponse } from '../../dist/index.mjs';

Deno.test('rate limiting through Deno.serve — allow then block', async () => {
    const store = new MemoryStore();
    const limiter = rateLimit({ limit: 2, windowMs: 60_000, store });
    const ac = new AbortController();

    const server = Deno.serve({ port: 0, signal: ac.signal, onListen() {} }, async req => {
        const result = await limiter(req);
        if (result.limited) {
            return await buildRateLimitResponse(req, result, {});
        }
        const headers = new Headers();
        for (const [k, v] of Object.entries(result.headers)) {
            headers.set(k, String(v));
        }
        return new Response('OK', { status: 200, headers });
    });

    const port = server.addr.port;
    const url = `http://localhost:${port}/`;

    try {
        const r1 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        assertEquals(r1.status, 200);
        await r1.body?.cancel();

        const r2 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        assertEquals(r2.status, 200);
        await r2.body?.cancel();

        const r3 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        assertEquals(r3.status, 429);
        await r3.body?.cancel();
    } finally {
        ac.abort();
        await server.finished;
        store.shutdown();
    }
});

Deno.test('429 response includes correct rate limit headers', async () => {
    const store = new MemoryStore();
    const limiter = rateLimit({ limit: 1, windowMs: 60_000, store });
    const ac = new AbortController();

    const server = Deno.serve({ port: 0, signal: ac.signal, onListen() {} }, async req => {
        const result = await limiter(req);
        if (result.limited) {
            return await buildRateLimitResponse(req, result, {});
        }
        const headers = new Headers();
        for (const [k, v] of Object.entries(result.headers)) {
            headers.set(k, String(v));
        }
        return new Response('OK', { status: 200, headers });
    });

    const port = server.addr.port;
    const url = `http://localhost:${port}/`;

    try {
        const r1 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        await r1.body?.cancel();

        const r2 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        assertEquals(r2.status, 429);

        const ratelimit = r2.headers.get('ratelimit') ?? '';
        assertEquals(/limit=1, remaining=0, reset=\d+/.test(ratelimit), true);
        assertEquals(r2.headers.get('ratelimit-policy'), '1;w=60');
        await r2.body?.cancel();
    } finally {
        ac.abort();
        await server.finished;
        store.shutdown();
    }
});

Deno.test('concurrent request burst', async () => {
    const limit = 5;
    const burst = 10;
    const store = new MemoryStore();
    const limiter = rateLimit({ limit, windowMs: 60_000, store });
    const ac = new AbortController();

    const server = Deno.serve({ port: 0, signal: ac.signal, onListen() {} }, async req => {
        const result = await limiter(req);
        if (result.limited) {
            return await buildRateLimitResponse(req, result, {});
        }
        return new Response('OK', { status: 200 });
    });

    const port = server.addr.port;
    const url = `http://localhost:${port}/`;

    try {
        const responses = await Promise.all(
            Array.from({ length: burst }, () => fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } }))
        );

        const statuses = responses.map(r => r.status);
        // Clean up response bodies
        await Promise.all(responses.map(r => r.body?.cancel()));

        const ok = statuses.filter(s => s === 200).length;
        const limited = statuses.filter(s => s === 429).length;

        assertEquals(ok, limit);
        assertEquals(limited, burst - limit);
    } finally {
        ac.abort();
        await server.finished;
        store.shutdown();
    }
});
