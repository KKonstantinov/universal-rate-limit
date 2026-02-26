import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { rateLimit, buildRateLimitResponse } from 'universal-rate-limit';
import type { RateLimitOptions } from 'universal-rate-limit';

export type { RateLimitOptions, RateLimitResult, Store, IncrementResult, MemoryStore } from 'universal-rate-limit';

export interface FastifyRateLimitOptions extends RateLimitOptions {
    keyGenerator?: (request: Request) => string | Promise<string>;
}

function fastifyRequestToRequest(req: FastifyRequest): Request {
    const protocol = req.protocol;
    const host = req.hostname || 'localhost';
    const url = `${protocol}://${host}${req.url}`;
    const headers = new Headers();

    const rawHeaders = req.headers;
    for (const [key, value] of Object.entries(rawHeaders)) {
        if (typeof value === 'string') {
            headers.set(key, value);
        } else if (Array.isArray(value)) {
            for (const v of value) {
                headers.append(key, v);
            }
        }
    }

    return new Request(url, {
        method: req.method,
        headers
    });
}

function rateLimitPlugin(fastify: FastifyInstance, options: FastifyRateLimitOptions): void {
    const limiter = rateLimit(options);

    fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const webRequest = fastifyRequestToRequest(request);
        const result = await limiter(webRequest);

        // Set rate limit headers
        for (const [key, value] of Object.entries(result.headers)) {
            void reply.header(key, value);
        }

        if (result.limited) {
            const response = await buildRateLimitResponse(webRequest, result, {
                handler: options.handler,
                message: options.message,
                statusCode: options.statusCode
            });

            const body = await response.text();
            const contentType = response.headers.get('content-type');
            void reply.code(response.status);
            if (contentType) {
                void reply.header('content-type', contentType);
            }
            return reply.send(body);
        }
    });
}

export const fastifyRateLimit = fp(rateLimitPlugin, {
    name: '@universal-rate-limit/fastify',
    fastify: '>=4.0.0'
});
