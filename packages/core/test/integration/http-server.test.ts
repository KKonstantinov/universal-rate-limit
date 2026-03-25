import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { rateLimit, buildRateLimitResponse } from '../../src/index.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function nodeRequestToWebRequest(req: http.IncomingMessage): Request {
    const url = `http://localhost${req.url ?? '/'}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
            headers.set(key, value);
        } else if (Array.isArray(value)) {
            for (const v of value) {
                headers.append(key, v);
            }
        }
    }
    return new Request(url, { method: req.method, headers });
}

function startServer(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; port: number }> {
    return new Promise(resolve => {
        const server = http.createServer(handler);
        server.listen(0, () => {
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            resolve({ server, port });
        });
    });
}

function closeServer(server: http.Server): Promise<void> {
    return new Promise(resolve => {
        server.close(() => resolve());
    });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('HTTP server integration', () => {
    let server: http.Server | undefined;

    afterEach(async () => {
        if (server) {
            await closeServer(server);
            server = undefined;
        }
    });

    it('allows requests under the limit and blocks over it', async () => {
        const limiter = rateLimit({ limit: 2, algorithm: { type: 'sliding-window', windowMs: 60_000 } });

        const started = await startServer(async (req, res) => {
            const webReq = nodeRequestToWebRequest(req);
            const result = await limiter(webReq);

            if (result.limited) {
                const response = await buildRateLimitResponse(webReq, result, {});
                res.writeHead(response.status, Object.fromEntries(response.headers));
                res.end(await response.text());
            } else {
                for (const [key, value] of Object.entries(result.headers)) {
                    res.setHeader(key, value);
                }
                res.writeHead(200);
                res.end('OK');
            }
        });
        server = started.server;

        const url = `http://localhost:${started.port}/`;

        const r1 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        expect(r1.status).toBe(200);

        const r2 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        expect(r2.status).toBe(200);

        const r3 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        expect(r3.status).toBe(429);
    });

    it('sends draft-7 rate limit headers over the wire', async () => {
        const limiter = rateLimit({ limit: 10, algorithm: { type: 'sliding-window', windowMs: 60_000 }, headers: 'draft-7' });

        const started = await startServer(async (req, res) => {
            const webReq = nodeRequestToWebRequest(req);
            const result = await limiter(webReq);
            for (const [key, value] of Object.entries(result.headers)) {
                res.setHeader(key, value);
            }
            res.writeHead(200);
            res.end('OK');
        });
        server = started.server;

        const r = await fetch(`http://localhost:${started.port}/`, {
            headers: { 'x-forwarded-for': '10.0.0.1' }
        });

        expect(r.headers.get('ratelimit')).toMatch(/limit=10, remaining=9, reset=\d+/);
        expect(r.headers.get('ratelimit-policy')).toBe('10;w=60');
    });

    it('sends draft-6 rate limit headers over the wire', async () => {
        const limiter = rateLimit({ limit: 5, algorithm: { type: 'sliding-window', windowMs: 60_000 }, headers: 'draft-6' });

        const started = await startServer(async (req, res) => {
            const webReq = nodeRequestToWebRequest(req);
            const result = await limiter(webReq);
            for (const [key, value] of Object.entries(result.headers)) {
                res.setHeader(key, value);
            }
            res.writeHead(200);
            res.end('OK');
        });
        server = started.server;

        const r = await fetch(`http://localhost:${started.port}/`, {
            headers: { 'x-forwarded-for': '10.0.0.1' }
        });

        expect(r.headers.get('ratelimit-limit')).toBe('5');
        expect(r.headers.get('ratelimit-remaining')).toBe('4');
        expect(r.headers.get('ratelimit-reset')).toMatch(/^\d+$/);
    });

    it('returns text/plain body for string messages on 429', async () => {
        const limiter = rateLimit({ limit: 1, algorithm: { type: 'sliding-window', windowMs: 60_000 } });

        const started = await startServer(async (req, res) => {
            const webReq = nodeRequestToWebRequest(req);
            const result = await limiter(webReq);
            if (result.limited) {
                const response = await buildRateLimitResponse(webReq, result, {
                    message: 'Slow down!'
                });
                res.writeHead(response.status, Object.fromEntries(response.headers));
                res.end(await response.text());
            } else {
                res.writeHead(200);
                res.end('OK');
            }
        });
        server = started.server;

        const url = `http://localhost:${started.port}/`;
        await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        const r2 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });

        expect(r2.status).toBe(429);
        expect(r2.headers.get('content-type')).toBe('text/plain');
        expect(await r2.text()).toBe('Slow down!');
    });

    it('returns application/json body for object messages on 429', async () => {
        const limiter = rateLimit({ limit: 1, algorithm: { type: 'sliding-window', windowMs: 60_000 } });

        const started = await startServer(async (req, res) => {
            const webReq = nodeRequestToWebRequest(req);
            const result = await limiter(webReq);
            if (result.limited) {
                const response = await buildRateLimitResponse(webReq, result, {
                    message: { error: 'rate_limited', retryAfter: 60 }
                });
                res.writeHead(response.status, Object.fromEntries(response.headers));
                res.end(await response.text());
            } else {
                res.writeHead(200);
                res.end('OK');
            }
        });
        server = started.server;

        const url = `http://localhost:${started.port}/`;
        await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        const r2 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });

        expect(r2.status).toBe(429);
        expect(r2.headers.get('content-type')).toBe('application/json');
        expect(await r2.json()).toEqual({ error: 'rate_limited', retryAfter: 60 });
    });

    it('tracks different clients separately by IP', async () => {
        const limiter = rateLimit({ limit: 1, algorithm: { type: 'sliding-window', windowMs: 60_000 } });

        const started = await startServer(async (req, res) => {
            const webReq = nodeRequestToWebRequest(req);
            const result = await limiter(webReq);
            if (result.limited) {
                res.writeHead(429);
                res.end('Limited');
            } else {
                res.writeHead(200);
                res.end('OK');
            }
        });
        server = started.server;

        const url = `http://localhost:${started.port}/`;
        const r1 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        const r2 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.2' } });
        const r3 = await fetch(url, { headers: { 'x-forwarded-for': '10.0.0.3' } });

        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(r3.status).toBe(200);
    });

    it('sliding-window sends correct headers and blocks after decay', async () => {
        const limiter = rateLimit({ limit: 3, algorithm: { type: 'sliding-window', windowMs: 60_000 } });

        const started = await startServer(async (req, res) => {
            const webReq = nodeRequestToWebRequest(req);
            const result = await limiter(webReq);
            if (result.limited) {
                const response = await buildRateLimitResponse(webReq, result, {});
                res.writeHead(response.status, Object.fromEntries(response.headers));
                res.end(await response.text());
            } else {
                for (const [key, value] of Object.entries(result.headers)) {
                    res.setHeader(key, value);
                }
                res.writeHead(200);
                res.end('OK');
            }
        });
        server = started.server;

        const url = `http://localhost:${started.port}/`;
        const ip = { headers: { 'x-forwarded-for': '10.0.0.1' } };

        // First request — check headers
        const r1 = await fetch(url, ip);
        expect(r1.status).toBe(200);
        expect(r1.headers.get('ratelimit')).toMatch(/limit=3, remaining=2, reset=\d+/);
        expect(r1.headers.get('ratelimit-policy')).toBe('3;w=60');

        // Fill remaining quota
        const r2 = await fetch(url, ip);
        expect(r2.status).toBe(200);
        expect(r2.headers.get('ratelimit')).toMatch(/remaining=1/);

        const r3 = await fetch(url, ip);
        expect(r3.status).toBe(200);
        expect(r3.headers.get('ratelimit')).toMatch(/remaining=0/);

        // Over limit — should get 429 with Retry-After
        const r4 = await fetch(url, ip);
        expect(r4.status).toBe(429);
        expect(r4.headers.get('retry-after')).toBeTruthy();
    });

    it('supports custom keyGenerator with x-api-key header', async () => {
        const limiter = rateLimit({
            limit: 1,
            algorithm: { type: 'sliding-window', windowMs: 60_000 },
            keyGenerator: (req: Request) => req.headers.get('x-api-key') ?? 'anonymous'
        });

        const started = await startServer(async (req, res) => {
            const webReq = nodeRequestToWebRequest(req);
            const result = await limiter(webReq);
            if (result.limited) {
                res.writeHead(429);
                res.end('Limited');
            } else {
                res.writeHead(200);
                res.end('OK');
            }
        });
        server = started.server;

        const url = `http://localhost:${started.port}/`;

        // Two different API keys should each get their own limit
        const r1 = await fetch(url, { headers: { 'x-api-key': 'key-a' } });
        const r2 = await fetch(url, { headers: { 'x-api-key': 'key-b' } });
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);

        // Same key again should be limited
        const r3 = await fetch(url, { headers: { 'x-api-key': 'key-a' } });
        expect(r3.status).toBe(429);
    });
});
