import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { fastifyRateLimit } from '../../src/index.js';

let app: FastifyInstance | undefined;

async function createApp(options = {}, fastifyOptions: FastifyServerOptions = {}): Promise<FastifyInstance> {
    app = Fastify(fastifyOptions);
    await app.register(fastifyRateLimit, { limit: 2, algorithm: { type: 'sliding-window', windowMs: 60_000 }, ...options });
    app.get('/', async () => 'OK');
    await app.ready();
    return app;
}

afterEach(async () => {
    if (app) {
        await app.close();
        app = undefined;
    }
});

describe('fastifyRateLimit', () => {
    it('allows requests under the limit', async () => {
        const server = await createApp();

        const res = await server.inject({
            method: 'GET',
            url: '/',
            headers: { 'x-forwarded-for': '20.0.0.1' }
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).toBe('OK');
    });

    it('blocks requests over the limit', async () => {
        const server = await createApp();

        await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.2' } });
        await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.2' } });
        const res = await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.2' } });

        expect(res.statusCode).toBe(429);
    });

    it('sets rate limit headers', async () => {
        const server = await createApp();

        const res = await server.inject({
            method: 'GET',
            url: '/',
            headers: { 'x-forwarded-for': '20.0.0.3' }
        });

        expect(res.headers['ratelimit']).toMatch(/limit=2/);
        expect(res.headers['ratelimit-policy']).toBeTruthy();
    });

    it('returns custom message on rate limit', async () => {
        const server = await createApp({ message: { error: 'rate_limited' } });

        await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.4' } });
        await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.4' } });
        const res = await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.4' } });

        expect(res.statusCode).toBe(429);
        expect(JSON.parse(res.body)).toEqual({ error: 'rate_limited' });
    });

    it('ignores a client-supplied X-Forwarded-For unless trustProxy is enabled', async () => {
        const server = await createApp();

        // Rotating the header must not buy a fresh limit per request
        await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.5' } });
        await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.6' } });
        const res = await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.7' } });

        expect(res.statusCode).toBe(429);
    });

    it('keys by the forwarded client IP when trustProxy is enabled', async () => {
        const server = await createApp({ limit: 1 }, { trustProxy: 'loopback' });

        const first = await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.8' } });
        const otherClient = await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.9' } });
        const firstAgain = await server.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-for': '20.0.0.8' } });

        expect(first.statusCode).toBe(200);
        expect(otherClient.statusCode).toBe(200);
        expect(firstAgain.statusCode).toBe(429);
    });
});
