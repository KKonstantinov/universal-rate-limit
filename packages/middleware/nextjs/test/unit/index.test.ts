import { describe, it, expect } from 'vitest';
import { withRateLimit, nextjsRateLimit } from '../../src/index.js';

function createRequest(ip = '30.0.0.1', path = '/'): Request {
    return new Request(`http://localhost${path}`, {
        headers: { 'x-forwarded-for': ip }
    });
}

describe('withRateLimit', () => {
    it('passes through requests under the limit', async () => {
        const handler = withRateLimit(async () => new Response('Hello'), {
            limit: 2,
            algorithm: { type: 'sliding-window', windowMs: 60_000 }
        });

        const res = await handler(createRequest());
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('Hello');
    });

    it('adds rate limit headers to successful responses', async () => {
        const handler = withRateLimit(async () => new Response('Hello'), {
            limit: 10,
            algorithm: { type: 'sliding-window', windowMs: 60_000 }
        });

        const res = await handler(createRequest('30.0.0.2'));
        expect(res.headers.get('RateLimit')).toMatch(/limit=10/);
        expect(res.headers.get('RateLimit-Policy')).toBeTruthy();
    });

    it('returns 429 when rate limited', async () => {
        const handler = withRateLimit(async () => new Response('Hello'), {
            limit: 1,
            algorithm: { type: 'sliding-window', windowMs: 60_000 }
        });

        await handler(createRequest('30.0.0.3'));
        const res = await handler(createRequest('30.0.0.3'));

        expect(res.status).toBe(429);
    });

    it('returns custom message when rate limited', async () => {
        const handler = withRateLimit(async () => new Response('Hello'), {
            limit: 1,
            algorithm: { type: 'sliding-window', windowMs: 60_000 },
            message: { error: 'too_many' }
        });

        await handler(createRequest('30.0.0.4'));
        const res = await handler(createRequest('30.0.0.4'));

        expect(res.status).toBe(429);
        expect(await res.json()).toEqual({ error: 'too_many' });
    });
});

describe('nextjsRateLimit', () => {
    it('returns a rate limit checker function', async () => {
        const check = nextjsRateLimit({ limit: 5, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
        const result = await check(createRequest('30.0.0.5'));

        expect(result.limited).toBe(false);
        expect(result.limit).toBe(5);
        expect(result.remaining).toBe(4);
    });

    it('reports limited when over the limit', async () => {
        const check = nextjsRateLimit({ limit: 1, algorithm: { type: 'sliding-window', windowMs: 60_000 } });

        await check(createRequest('30.0.0.6'));
        const result = await check(createRequest('30.0.0.6'));

        expect(result.limited).toBe(true);
        expect(result.remaining).toBe(0);
    });
});
