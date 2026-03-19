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

describe('Concurrent requests', () => {
    let server: http.Server | undefined;

    afterEach(async () => {
        if (server) {
            await closeServer(server);
            server = undefined;
        }
    });

    it('burst from same IP — exactly limit get 200, rest get 429', async () => {
        const limit = 5;
        const burst = 10;
        const limiter = rateLimit({ limit, windowMs: 60_000 });

        const started = await startServer(async (req, res) => {
            const webReq = nodeRequestToWebRequest(req);
            const result = await limiter(webReq);
            if (result.limited) {
                const response = await buildRateLimitResponse(webReq, result, {});
                res.writeHead(response.status);
                res.end('Limited');
            } else {
                res.writeHead(200);
                res.end('OK');
            }
        });
        server = started.server;

        const url = `http://localhost:${started.port}/`;
        const responses = await Promise.all(
            Array.from({ length: burst }, () => fetch(url, { headers: { 'x-forwarded-for': '10.0.0.1' } }))
        );

        const statuses = responses.map(r => r.status);
        const ok = statuses.filter(s => s === 200).length;
        const limited = statuses.filter(s => s === 429).length;

        expect(ok).toBe(limit);
        expect(limited).toBe(burst - limit);
    });

    it('concurrent requests from different IPs all succeed', async () => {
        const limiter = rateLimit({ limit: 1, windowMs: 60_000 });

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
        const responses = await Promise.all(
            Array.from({ length: 10 }, (_, i) => fetch(url, { headers: { 'x-forwarded-for': `10.0.0.${i + 1}` } }))
        );

        const statuses = responses.map(r => r.status);
        expect(statuses.every(s => s === 200)).toBe(true);
    });

    it('burst then wait less than window then one more — still limited', async () => {
        const limiter = rateLimit({ limit: 2, windowMs: 60_000 });

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
        const ip = { headers: { 'x-forwarded-for': '10.0.0.1' } };

        // Exhaust the limit
        await fetch(url, ip);
        await fetch(url, ip);

        // Wait less than the window
        await new Promise(resolve => setTimeout(resolve, 500));

        // Should still be limited
        const r = await fetch(url, ip);
        expect(r.status).toBe(429);
    });
});
