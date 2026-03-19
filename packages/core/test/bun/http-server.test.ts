import { describe, it, expect, afterEach } from 'bun:test';
import { rateLimit, buildRateLimitResponse } from '../../dist/index.mjs';

describe('Bun.serve integration', () => {
    let server: ReturnType<typeof Bun.serve> | undefined;

    afterEach(() => {
        if (server) {
            server.stop(true);
            server = undefined;
        }
    });

    it('rate limits through Bun.serve — allow then block', async () => {
        const limiter = rateLimit({ limit: 2, windowMs: 60_000 });

        server = Bun.serve({
            port: 0,
            async fetch(req: Request) {
                const result = await limiter(req);
                if (result.limited) {
                    return await buildRateLimitResponse(req, result, {});
                }
                const headers = new Headers(result.headers);
                return new Response('OK', { status: 200, headers });
            }
        });

        const url = `http://localhost:${server.port}/`;

        const r1 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        expect(r1.status).toBe(200);

        const r2 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        expect(r2.status).toBe(200);

        const r3 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        expect(r3.status).toBe(429);
    });

    it('429 response includes correct rate limit headers', async () => {
        const limiter = rateLimit({ limit: 1, windowMs: 60_000 });

        server = Bun.serve({
            port: 0,
            async fetch(req: Request) {
                const result = await limiter(req);
                if (result.limited) {
                    return await buildRateLimitResponse(req, result, {});
                }
                const headers = new Headers(result.headers);
                return new Response('OK', { status: 200, headers });
            }
        });

        const url = `http://localhost:${server.port}/`;
        await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        const r2 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });

        expect(r2.status).toBe(429);
        expect(r2.headers.get('ratelimit')).toMatch(/limit=1, remaining=0, reset=\d+/);
        expect(r2.headers.get('ratelimit-policy')).toBe('1;w=60');
    });

    it('concurrent burst — exactly limit get 200', async () => {
        const limit = 5;
        const burst = 10;
        const limiter = rateLimit({ limit, windowMs: 60_000 });

        server = Bun.serve({
            port: 0,
            async fetch(req: Request) {
                const result = await limiter(req);
                if (result.limited) {
                    return await buildRateLimitResponse(req, result, {});
                }
                return new Response('OK', { status: 200 });
            }
        });

        const url = `http://localhost:${server.port}/`;
        const responses = await Promise.all(
            Array.from({ length: burst }, () => fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } }))
        );

        const statuses = responses.map(r => r.status);
        const ok = statuses.filter(s => s === 200).length;
        const limited = statuses.filter(s => s === 429).length;

        expect(ok).toBe(limit);
        expect(limited).toBe(burst - limit);
    });
});
