import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { rateLimit, MemoryStore, buildRateLimitResponse } from '../../src/index.js';

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

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Window expiration (real timers)', () => {
    let server: http.Server | undefined;

    afterEach(async () => {
        if (server) {
            await closeServer(server);
            server = undefined;
        }
    });

    it('window resets after expiry', async () => {
        const windowMs = 500;
        const limiter = rateLimit({ limit: 1, algorithm: { type: 'fixed-window', windowMs } });

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
        const ip = { headers: { 'x-forwarded-for': '10.0.0.1' } };

        const r1 = await fetch(url, ip);
        expect(r1.status).toBe(200);

        const r2 = await fetch(url, ip);
        expect(r2.status).toBe(429);

        // Wait for window to expire (500ms window + generous margin)
        await sleep(700);

        const r3 = await fetch(url, ip);
        expect(r3.status).toBe(200);
    });

    it('mid-window request remains limited', async () => {
        // Per-user window starts from first request; 200ms sleep is well within 60s window.
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
        const ip = { headers: { 'x-forwarded-for': '10.0.0.1' } };

        const r1 = await fetch(url, ip);
        expect(r1.status).toBe(200);

        // Wait 200ms — well within the 60s window
        await sleep(200);

        const r2 = await fetch(url, ip);
        expect(r2.status).toBe(429);
    });

    it('sliding window with real timers allows requests after partial window', async () => {
        const limiter = rateLimit({
            limit: 10,
            algorithm: { type: 'sliding-window', windowMs: 500 }
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
        const ip = { headers: { 'x-forwarded-for': '10.0.0.1' } };

        // Fill 8 hits in current window
        for (let i = 0; i < 8; i++) {
            await fetch(url, ip);
        }

        // Wait for the window to expire and then some into the next window
        // so the previous window's weight is reduced
        await sleep(750);

        // In a new window, previous hits are weighted down significantly
        // At ~50% through new window: weighted = 8 * 0.5 + 1 = ~5 (under 10)
        const r = await fetch(url, ip);
        expect(r.status).toBe(200);
    });

    it('sliding-window blocks shortly after window boundary', async () => {
        const windowMs = 2000;
        const limiter = rateLimit({ limit: 3, algorithm: { type: 'sliding-window', windowMs } });

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

        // Fill all 3 allowed requests (per-user window starts from first request)
        for (let i = 0; i < 3; i++) {
            const r = await fetch(url, ip);
            expect(r.status).toBe(200);
        }

        // Wait just past the window boundary (windowMs + 150ms into the next window).
        // weight = 1 - (150/2000) = 0.925; ceil(3 * 0.925 + 1) = ceil(3.775) = 4 > 3 → still blocked.
        await sleep(windowMs + 150);

        // Previous hits weighted heavily → still blocked
        const r = await fetch(url, ip);
        expect(r.status).toBe(429);
    });

    it('sliding-window unblocks after sufficient decay', async () => {
        const windowMs = 2000;
        const limiter = rateLimit({ limit: 3, algorithm: { type: 'sliding-window', windowMs } });

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

        // Fill all 3 allowed requests (per-user window starts from first request)
        for (let i = 0; i < 3; i++) {
            const r = await fetch(url, ip);
            expect(r.status).toBe(200);
        }

        // Wait well into the next window so weight decays enough
        // At 75% through window 2: weight = 0.25, ceil(3 * 0.25 + 1) = ceil(1.75) = 2 ≤ 3
        await sleep(windowMs + Math.floor(windowMs * 0.75));

        const r = await fetch(url, ip);
        expect(r.status).toBe(200);
    });

    it('MemoryStore cleanup runs on schedule', async () => {
        const store = new MemoryStore();
        try {
            const limiter = rateLimit({ limit: 1, algorithm: { type: 'fixed-window', windowMs: 500 }, store });

            const req = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '10.0.0.1' }
            });

            const r1 = await limiter(req);
            expect(r1.limited).toBe(false);

            const r2 = await limiter(req);
            expect(r2.limited).toBe(true);

            // Wait for window expiry + cleanup interval
            await sleep(700);

            // After cleanup, the store should have a fresh start
            const r3 = await limiter(req);
            expect(r3.limited).toBe(false);
        } finally {
            store.shutdown();
        }
    });
});

describe('Retry-After correctness (real timers)', () => {
    let server: http.Server | undefined;

    afterEach(async () => {
        if (server) {
            await closeServer(server);
            server = undefined;
        }
    });

    it('fixed-window: wait Retry-After duration then unblocked', async () => {
        const limiter = rateLimit({ limit: 2, algorithm: { type: 'fixed-window', windowMs: 2000 } });

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

        // Exhaust the limit
        await fetch(url, ip);
        await fetch(url, ip);

        // Get 429 with Retry-After
        const blocked = await fetch(url, ip);
        expect(blocked.status).toBe(429);
        const retryAfter = Number(blocked.headers.get('retry-after'));
        expect(retryAfter).toBeGreaterThan(0);

        // Wait the Retry-After duration + margin
        await sleep(retryAfter * 1000 + 200);

        // Should be unblocked
        const unblocked = await fetch(url, ip);
        expect(unblocked.status).toBe(200);
    });

    it('sliding-window: wait Retry-After duration then unblocked', async () => {
        const limiter = rateLimit({ limit: 2, algorithm: { type: 'sliding-window', windowMs: 2000 } });

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

        // Exhaust the limit
        await fetch(url, ip);
        await fetch(url, ip);

        // Get 429 with Retry-After
        const blocked = await fetch(url, ip);
        expect(blocked.status).toBe(429);
        const retryAfter = Number(blocked.headers.get('retry-after'));
        expect(retryAfter).toBeGreaterThan(0);

        // Wait the Retry-After duration + margin
        await sleep(retryAfter * 1000 + 200);

        // Should be unblocked
        const unblocked = await fetch(url, ip);
        expect(unblocked.status).toBe(200);
    });

    it('token-bucket: wait Retry-After duration then unblocked', async () => {
        const limiter = rateLimit({ limit: 2, algorithm: { type: 'token-bucket', refillRate: 2 } });

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

        // Exhaust the limit (2 tokens)
        await fetch(url, ip);
        await fetch(url, ip);

        // Get 429 with Retry-After
        const blocked = await fetch(url, ip);
        expect(blocked.status).toBe(429);
        const retryAfter = Number(blocked.headers.get('retry-after'));
        expect(retryAfter).toBeGreaterThan(0);

        // Wait the Retry-After duration + margin
        await sleep(retryAfter * 1000 + 200);

        // Should be unblocked
        const unblocked = await fetch(url, ip);
        expect(unblocked.status).toBe(200);
    });
});

describe('Token bucket (real timers)', () => {
    let server: http.Server | undefined;

    afterEach(async () => {
        if (server) {
            await closeServer(server);
            server = undefined;
        }
    });

    it('exhaust tokens, wait for refill, then unblocked', async () => {
        // refillRate=2 means 2 tokens/sec; limit=2 means bucket starts with 2 tokens
        const limiter = rateLimit({ limit: 2, algorithm: { type: 'token-bucket', refillRate: 2 } });

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

        // Exhaust both tokens
        const r1 = await fetch(url, ip);
        expect(r1.status).toBe(200);
        const r2 = await fetch(url, ip);
        expect(r2.status).toBe(200);

        // Should be limited
        const r3 = await fetch(url, ip);
        expect(r3.status).toBe(429);

        // Wait 600ms — enough for 1.2 tokens at 2 tokens/sec
        await sleep(600);

        // Should be unblocked (at least 1 token refilled)
        const r4 = await fetch(url, ip);
        expect(r4.status).toBe(200);
    });

    it('mid-refill remains limited', async () => {
        // refillRate=1 means 1 token/sec; limit=5 means bucket starts with 5 tokens
        const limiter = rateLimit({ limit: 5, algorithm: { type: 'token-bucket', refillRate: 1 } });

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

        // Exhaust all 5 tokens
        for (let i = 0; i < 5; i++) {
            const r = await fetch(url, ip);
            expect(r.status).toBe(200);
        }

        // Should be limited
        const blocked = await fetch(url, ip);
        expect(blocked.status).toBe(429);

        // Wait 200ms — only 0.2 tokens at 1 token/sec, not enough
        await sleep(200);

        // Should still be limited
        const stillBlocked = await fetch(url, ip);
        expect(stillBlocked.status).toBe(429);
    });
});
