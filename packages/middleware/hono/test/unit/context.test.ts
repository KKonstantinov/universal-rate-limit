import { describe, it, expect, expectTypeOf } from 'vitest';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import type { RateLimitOptions } from 'universal-rate-limit';
import { honoRateLimit } from '../../src/index.js';
import type { HonoRateLimitOptions } from '../../src/index.js';

type TestEnv = { Variables: { tenant: string; allowance: number } };

function createApp(options: HonoRateLimitOptions<TestEnv>) {
    const app = new Hono<TestEnv>();
    app.onError(() => new Response('Unexpected error', { status: 500 }));
    app.use('*', async (c, next) => {
        // Fixtures stand in for identity supplied by upstream authentication.
        c.set('tenant', c.req.header('x-test-tenant') ?? 'alpha');
        c.set('allowance', 3);
        await next();
    });
    app.use('*', honoRateLimit<TestEnv>({ algorithm: { type: 'fixed-window', windowMs: 60_000 }, ...options }));
    app.get('*', c => c.text('OK'));
    return app;
}

describe('Hono context callbacks', () => {
    it('keys independent tenant budgets from typed context after authentication', async () => {
        const app = createApp({
            limit: 1,
            keyGenerator: async (request, c) => {
                expectTypeOf(request).toEqualTypeOf<Request>();
                expectTypeOf(c).toEqualTypeOf<Context<TestEnv>>();
                expect(request).toBe(c.req.raw);
                await Promise.resolve();
                return c.get('tenant');
            }
        });
        expect(await app.request('/')).toMatchObject({ status: 200 });
        expect(await app.request('/')).toMatchObject({ status: 429 });
        expect(await app.request('/', { headers: { 'x-test-tenant': 'beta' } })).toMatchObject({ status: 200 });
    });

    it('resolves asynchronous limits and weighted costs from the current context', async () => {
        const app = createApp({
            limit: async (request, c) => {
                expect(request).toBe(c.req.raw);
                return c.get('allowance');
            },
            cost: async (request, c) => {
                expect(request).toBe(c.req.raw);
                return c.req.path === '/expensive' ? 2 : 1;
            },
            keyGenerator: (_request, c) => c.get('tenant')
        });
        const first = await app.request('/expensive');
        expect(first.status).toBe(200);
        expect(first.headers.get('RateLimit')).toContain('remaining=1');
        expect(await app.request('/cheap')).toMatchObject({ status: 200 });
        expect(await app.request('/cheap')).toMatchObject({ status: 429 });
    });

    it('uses context when asynchronously skipping a request without spending capacity', async () => {
        const app = createApp({
            limit: 1,
            skip: async (request, c) => {
                expect(request).toBe(c.req.raw);
                return c.req.path === '/health' && c.get('tenant') === 'alpha';
            }
        });
        expect(await app.request('/health')).toMatchObject({ status: 200 });
        expect(await app.request('/')).toMatchObject({ status: 200 });
        expect(await app.request('/')).toMatchObject({ status: 429 });
    });

    it('passes context as the final argument to a custom asynchronous handler', async () => {
        const app = createApp({
            limit: 0,
            handler: async (request, result, c) => {
                expect(request).toBe(c.req.raw);
                return c.json({ tenant: c.get('tenant'), limited: result.limited }, 429);
            }
        });
        const response = await app.request('/');
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ tenant: 'alpha', limited: true });
    });

    it('passes context as the final argument to a custom message', async () => {
        const app = createApp({
            limit: 0,
            message: (request, result, c) => ({ tenant: c.get('tenant'), path: new URL(request.url).pathname, remaining: result.remaining })
        });
        const response = await app.request('/limited');
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ tenant: 'alpha', path: '/limited', remaining: 0 });
    });

    it('accepts existing core options and request-only callbacks unchanged', async () => {
        const options: RateLimitOptions = {
            limit: request => (request.method === 'GET' ? 1 : 2),
            keyGenerator: request => new URL(request.url).pathname,
            handler: (request, result) => Response.json({ method: request.method, limited: result.limited }, { status: 429 })
        };
        const middleware = honoRateLimit<TestEnv>(options);
        expectTypeOf(middleware).toEqualTypeOf<MiddlewareHandler<TestEnv>>();
        const app = new Hono<TestEnv>();
        app.use('*', middleware);
        app.get('/', c => c.text('OK'));
        expect(await app.request('/')).toMatchObject({ status: 200 });
        const response = await app.request('/');
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ method: 'GET', limited: true });
    });
});
