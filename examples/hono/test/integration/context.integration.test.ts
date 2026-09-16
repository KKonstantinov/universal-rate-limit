import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { honoRateLimit, MemoryStore } from '@universal-rate-limit/hono';

type TestEnv = { Variables: { tenant: string; allowance: number } };

describe('Hono context over HTTP with a shared store', () => {
    let store: MemoryStore;
    let servers: ServerType[];

    beforeEach(() => {
        store = new MemoryStore();
        servers = [];
    });

    afterEach(async () => {
        await Promise.all(
            servers.map(
                server =>
                    new Promise<void>((resolve, reject) => {
                        server.close(error => (error ? reject(error) : resolve()));
                    })
            )
        );
        store.shutdown();
    });

    async function startServer(): Promise<string> {
        const app = new Hono<TestEnv>();
        app.use('*', async (c, next) => {
            // Only a test fixture: applications obtain these values from verified authentication.
            c.set('tenant', c.req.header('x-test-tenant') ?? 'alpha');
            c.set('allowance', 3);
            c.header('x-request-id', 'http-request');
            await next();
        });
        app.use(
            '*',
            honoRateLimit<TestEnv>({
                store,
                prefix: 'http',
                algorithm: { type: 'fixed-window', windowMs: 60_000 },
                keyGenerator: async (_request, c) => {
                    await Promise.resolve();
                    return c.get('tenant');
                },
                limit: async (_request, c) => c.get('allowance'),
                cost: async (_request, c) => (c.req.path === '/heavy' ? 2 : 1),
                handler: (_request, _result, c) =>
                    Response.json(
                        { tenant: c.get('tenant') },
                        {
                            status: 429,
                            headers: {
                                'content-type': 'application/problem+json',
                                'cache-control': 'no-store',
                                'x-policy': 'tenant'
                            }
                        }
                    )
            })
        );
        app.get('*', () => new Response('OK', { headers: { 'x-route': 'retained' } }));
        const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
        servers.push(server);
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
        return `http://127.0.0.1:${String(address.port)}`;
    }

    it('shares each tenant allowance across both servers while keeping concurrent tenant contexts isolated', async () => {
        const urls = await Promise.all([startServer(), startServer()]);
        const outcomes = await Promise.all(
            Array.from({ length: 20 }, async (_, index) => {
                const tenant = index % 2 === 0 ? 'alpha' : 'beta';
                const url = urls[Math.floor(index / 2) % 2];
                const response = await fetch(url, { headers: { 'x-test-tenant': tenant } });
                const body = await response.text();
                expect(response.headers.get('RateLimit')).toBeTruthy();
                return { tenant, status: response.status, body };
            })
        );
        for (const tenant of ['alpha', 'beta']) {
            const own = outcomes.filter(outcome => outcome.tenant === tenant);
            expect(own.filter(outcome => outcome.status === 200)).toHaveLength(3);
            const rejected = own.filter(outcome => outcome.status === 429);
            expect(rejected).toHaveLength(7);
            for (const outcome of rejected) expect(JSON.parse(outcome.body)).toEqual({ tenant });
        }
    });

    it('consumes weighted requests across servers and preserves refusal headers over the socket', async () => {
        const first = await startServer();
        const second = await startServer();
        const heavy = await fetch(`${first}/heavy`);
        expect(heavy.status).toBe(200);
        expect(heavy.headers.get('RateLimit')).toContain('remaining=1');
        expect(heavy.headers.get('x-route')).toBe('retained');
        await heavy.text();
        const last = await fetch(second);
        expect(last.status).toBe(200);
        await last.text();
        const refused = await fetch(first);
        expect(refused.status).toBe(429);
        expect(refused.headers.get('content-type')).toBe('application/problem+json');
        expect(refused.headers.get('cache-control')).toBe('no-store');
        expect(refused.headers.get('x-policy')).toBe('tenant');
        expect(refused.headers.get('x-request-id')).toBe('http-request');
        expect(refused.headers.get('Retry-After')).toBeTruthy();
        expect(await refused.json()).toEqual({ tenant: 'alpha' });
    });
});
