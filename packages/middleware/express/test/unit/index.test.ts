import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { expressRateLimit } from '../../src/index.js';

let server: Server | undefined;

function createApp(options = {}) {
    const app = express();
    app.use(expressRateLimit({ limit: 2, algorithm: { type: 'sliding-window', windowMs: 60_000 }, ...options }));
    app.get('/', (_req, res) => {
        res.send('OK');
    });
    return app;
}

async function listen(app: express.Express): Promise<string> {
    return new Promise(resolve => {
        server = app.listen(0, () => {
            const addr = server!.address();
            if (typeof addr === 'object' && addr) {
                resolve(`http://127.0.0.1:${String(addr.port)}`);
            }
        });
    });
}

afterEach(async () => {
    if (server) {
        await new Promise<void>((resolve, reject) => {
            server!.close(err => {
                if (err) reject(err);
                else resolve();
            });
        });
        server = undefined;
    }
});

describe('expressRateLimit', () => {
    it('allows requests under the limit', async () => {
        const app = createApp();
        const base = await listen(app);

        const res = await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.1' } });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('OK');
    });

    it('blocks requests over the limit', async () => {
        const app = createApp();
        const base = await listen(app);

        await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.2' } });
        await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.2' } });
        const res = await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.2' } });

        expect(res.status).toBe(429);
    });

    it('sets rate limit headers', async () => {
        const app = createApp();
        const base = await listen(app);

        const res = await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.3' } });
        expect(res.headers.get('ratelimit')).toMatch(/limit=2/);
        expect(res.headers.get('ratelimit-policy')).toBeTruthy();
    });

    it('returns custom message on rate limit', async () => {
        const app = createApp({ message: 'Slow down!' });
        const base = await listen(app);

        await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.4' } });
        await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.4' } });
        const res = await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.4' } });

        expect(res.status).toBe(429);
        expect(await res.text()).toBe('Slow down!');
    });

    it('ignores a client-supplied X-Forwarded-For unless trust proxy is enabled', async () => {
        const app = createApp();
        const base = await listen(app);

        // Rotating the header must not buy a fresh limit per request
        await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.5' } });
        await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.6' } });
        const res = await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.7' } });

        expect(res.status).toBe(429);
    });

    it('keys by the forwarded client IP when trust proxy is enabled', async () => {
        const app = createApp({ limit: 1 });
        app.set('trust proxy', 'loopback');
        const base = await listen(app);

        const first = await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.8' } });
        const otherClient = await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.9' } });
        const firstAgain = await fetch(base, { headers: { 'x-forwarded-for': '10.0.0.8' } });

        expect(first.status).toBe(200);
        expect(otherClient.status).toBe(200);
        expect(firstAgain.status).toBe(429);
    });
});
