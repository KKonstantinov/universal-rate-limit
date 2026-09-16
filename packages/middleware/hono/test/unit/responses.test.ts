import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { honoRateLimit } from '../../src/index.js';

describe('Hono response preservation', () => {
    it('does not duplicate inherited cookies when a custom handler uses c.json', async () => {
        const app = new Hono();
        app.use('*', async (c, next) => {
            c.header('set-cookie', 'session=1; Path=/; HttpOnly', { append: true });
            await next();
        });
        app.use('*', honoRateLimit({ limit: 0, handler: (_request, _result, c) => c.json({ limited: true }, 429) }));
        const response = await app.request('/');
        expect(response.status).toBe(429);
        expect(response.headers.getSetCookie()).toEqual(['session=1; Path=/; HttpOnly']);
    });

    it('preserves custom values and both cookie sources after upstream materializes the response', async () => {
        const app = new Hono();
        app.use('*', async (c, next) => {
            c.res.headers.set('x-custom', 'upstream');
            c.res.headers.append('set-cookie', 'session=1; Path=/; HttpOnly');
            await next();
        });
        app.use(
            '*',
            honoRateLimit({
                limit: 0,
                handler: () =>
                    new Response('limited', {
                        status: 429,
                        headers: { 'x-custom': 'handler', 'set-cookie': 'refusal=1; Path=/; HttpOnly' }
                    })
            })
        );
        const response = await app.request('/');
        expect(response.status).toBe(429);
        expect(response.headers.get('x-custom')).toBe('handler');
        expect(response.headers.getSetCookie()).toEqual(['session=1; Path=/; HttpOnly', 'refusal=1; Path=/; HttpOnly']);
    });

    it('preserves custom response status text', async () => {
        const app = new Hono();
        app.use('*', honoRateLimit({ limit: 0, handler: () => new Response('limited', { status: 429, statusText: 'Quota exhausted' }) }));
        const response = await app.request('/');
        expect(response.status).toBe(429);
        expect(response.statusText).toBe('Quota exhausted');
    });

    it('keeps the rejecting inner limiter policy when the outer limiter admits the request', async () => {
        const app = new Hono();
        app.use('*', honoRateLimit({ limit: 100 }));
        app.use('*', honoRateLimit({ limit: 1 }));
        app.get('/', c => c.text('OK'));
        expect(await app.request('/')).toMatchObject({ status: 200 });
        const response = await app.request('/');
        expect(response.status).toBe(429);
        expect(response.headers.get('RateLimit')).toContain('limit=1, remaining=0');
        expect(response.headers.get('RateLimit-Policy')).toBe('1;w=60');
        expect(response.headers.get('Retry-After')).toBeTruthy();
    });

    it.each([200, 400, 500])('sets headers on a raw downstream response with status %i', async status => {
        const app = new Hono();
        app.use('*', honoRateLimit({ limit: 2 }));
        app.get('/', () => new Response('body', { status, headers: { 'x-route': 'retained' } }));
        const response = await app.request('/');
        expect(response.status).toBe(status);
        expect(response.headers.get('x-route')).toBe('retained');
        expect(response.headers.get('RateLimit')).toContain('remaining=1');
        expect(await response.text()).toBe('body');
    });

    it('sets headers on a raw response returned by the error handler', async () => {
        const app = new Hono();
        app.use('*', honoRateLimit({ limit: 2 }));
        app.onError(() => new Response('problem', { status: 500, headers: { 'content-type': 'application/problem+json' } }));
        app.get('/', () => {
            throw new Error('failed');
        });
        const response = await app.request('/');
        expect(response.status).toBe(500);
        expect(response.headers.get('RateLimit')).toContain('remaining=1');
        expect(await response.text()).toBe('problem');
    });

    it('preserves custom refusal headers, cookies, bytes and upstream headers', async () => {
        const app = new Hono();
        const bytes = new Uint8Array([0, 128, 255]);
        app.use('*', async (c, next) => {
            c.header('x-request-id', 'request-123');
            await next();
        });
        app.use(
            '*',
            honoRateLimit({
                limit: 0,
                handler: () =>
                    new Response(bytes, {
                        status: 429,
                        headers: [
                            ['content-type', 'application/octet-stream'],
                            ['cache-control', 'no-store'],
                            ['x-custom', 'retained'],
                            ['set-cookie', 'first=1; Path=/; HttpOnly'],
                            ['set-cookie', 'second=2; Path=/; HttpOnly']
                        ]
                    })
            })
        );
        const response = await app.request('/');
        expect(response.status).toBe(429);
        expect(response.headers.get('x-request-id')).toBe('request-123');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('x-custom')).toBe('retained');
        expect(response.headers.getSetCookie()).toEqual(['first=1; Path=/; HttpOnly', 'second=2; Path=/; HttpOnly']);
        expect(response.headers.get('RateLimit')).toContain('remaining=0');
        expect(response.headers.get('Retry-After')).toBeTruthy();
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    });

    it('does not read a custom refusal body before returning the response', async () => {
        let mayRead = false;
        const body = new ReadableStream<Uint8Array>(
            {
                pull(controller) {
                    if (!mayRead) {
                        controller.error(new Error('Body consumed by middleware'));
                        return;
                    }
                    controller.enqueue(new Uint8Array([128, 255]));
                    controller.close();
                }
            },
            { highWaterMark: 0 }
        );
        const app = new Hono();
        app.onError(() => new Response('Unexpected error', { status: 500 }));
        app.use('*', honoRateLimit({ limit: 0, handler: () => new Response(body, { status: 429 }) }));
        const response = await app.request('/');
        expect(response.status).toBe(429);
        expect(response.bodyUsed).toBe(false);
        mayRead = true;
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([128, 255]));
    });

    it('adds headers to an immutable redirect returned by a downstream handler', async () => {
        const app = new Hono();
        app.use('*', honoRateLimit({ limit: 2 }));
        app.get('/', () => Response.redirect('https://example.com/destination', 307));
        const response = await app.request('/');
        expect(response.status).toBe(307);
        expect(response.headers.get('location')).toBe('https://example.com/destination');
        expect(response.headers.get('RateLimit')).toContain('remaining=1');
    });
});
