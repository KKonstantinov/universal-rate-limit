import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { honoRateLimit } from '../src/index.js';

function createApp(options = {}) {
    const app = new Hono();
    app.use('*', honoRateLimit({ limit: 2, windowMs: 60_000, ...options }));
    app.get('/', c => c.text('OK'));
    return app;
}

describe('honoRateLimit', () => {
    it('allows requests under the limit', async () => {
        const app = createApp();
        const res = await app.request('/');

        expect(res.status).toBe(200);
        expect(await res.text()).toBe('OK');
        expect(res.headers.get('RateLimit')).toBeTruthy();
    });

    it('blocks requests over the limit', async () => {
        const app = createApp();

        await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } });
        await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } });
        const res = await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } });

        expect(res.status).toBe(429);
    });

    it('sets rate limit headers on all responses', async () => {
        const app = createApp();
        const res = await app.request('/', { headers: { 'x-forwarded-for': '3.3.3.3' } });

        expect(res.headers.get('RateLimit')).toMatch(/limit=2/);
        expect(res.headers.get('RateLimit-Policy')).toBeTruthy();
    });

    it('uses draft-6 headers when configured', async () => {
        const app = createApp({ headers: 'draft-6' as const });
        const res = await app.request('/', { headers: { 'x-forwarded-for': '4.4.4.4' } });

        expect(res.headers.get('RateLimit-Limit')).toBe('2');
        expect(res.headers.get('RateLimit-Remaining')).toBe('1');
        expect(res.headers.get('RateLimit-Reset')).toBeTruthy();
    });

    it('returns custom message on rate limit', async () => {
        const app = createApp({ message: { error: 'too_fast' } });

        await app.request('/', { headers: { 'x-forwarded-for': '5.5.5.5' } });
        await app.request('/', { headers: { 'x-forwarded-for': '5.5.5.5' } });
        const res = await app.request('/', { headers: { 'x-forwarded-for': '5.5.5.5' } });

        expect(res.status).toBe(429);
        expect(await res.json()).toEqual({ error: 'too_fast' });
    });
});
