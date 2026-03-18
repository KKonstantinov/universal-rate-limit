import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { rateLimit, MemoryStore, buildRateLimitResponse } from '../../packages/core/src/index.js';

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

/**
 * Wait until we're safely away from a clock-aligned window boundary.
 * MemoryStore aligns windows to `Math.floor(now / windowMs) * windowMs`,
 * so back-to-back requests near a boundary can land in different windows.
 */
async function waitForSafeWindowPosition(windowMs: number): Promise<void> {
    const position = Date.now() % windowMs;
    if (position > windowMs - 50) {
        await sleep(windowMs - position + 10);
    }
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
        const limiter = rateLimit({ limit: 1, windowMs });

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

        // Ensure both requests land in the same clock-aligned window
        await waitForSafeWindowPosition(windowMs);

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
        // Use a long window (60s) so the 200ms sleep cannot cross a
        // clock-aligned window boundary and accidentally reset the count.
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
            windowMs: 500,
            algorithm: 'sliding-window'
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

    it('MemoryStore cleanup runs on schedule', async () => {
        const store = new MemoryStore(500, 'fixed-window');
        try {
            const limiter = rateLimit({ limit: 1, windowMs: 500, store });

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
