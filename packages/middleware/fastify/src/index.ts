import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { rateLimit, buildRateLimitResponse } from 'universal-rate-limit';
import type { RateLimitOptions } from 'universal-rate-limit';

export type { RateLimitOptions, RateLimitResult, Store, IncrementResult, MemoryStore } from 'universal-rate-limit';

/** Rate limit options for the Fastify plugin adapter. */
export type FastifyRateLimitOptions = RateLimitOptions<FastifyRequest>;

/** Common proxy/CDN headers that carry the client's real IP address. */
const IP_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'fly-client-ip'];

/**
 * Default key generator for Fastify that reads client IP from well-known
 * proxy headers, falling back to Fastify's `request.ip`.
 */
function fastifyDefaultKeyGenerator(req: FastifyRequest): string {
    for (const header of IP_HEADERS) {
        const value = req.headers[header];
        if (typeof value === 'string') {
            return value.split(',')[0].trim();
        }
    }
    return req.ip;
}

/**
 * Internal Fastify plugin that registers an `onRequest` hook for rate limiting.
 */
function rateLimitPlugin(fastify: FastifyInstance, options: FastifyRateLimitOptions): void {
    const resolvedOptions: FastifyRateLimitOptions = {
        keyGenerator: fastifyDefaultKeyGenerator,
        ...options
    };
    const limiter = rateLimit<FastifyRequest>(resolvedOptions);

    fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const result = await limiter(request);

        // Set rate limit headers
        for (const [key, value] of Object.entries(result.headers)) {
            reply.header(key, value);
        }

        if (result.limited) {
            const response = await buildRateLimitResponse<FastifyRequest>(request, result, {
                handler: options.handler,
                message: options.message,
                statusCode: options.statusCode
            });

            const body = await response.text();
            const contentType = response.headers.get('content-type');
            reply.code(response.status);
            if (contentType) {
                reply.header('content-type', contentType);
            }
            return reply.send(body);
        }
    });
}

/**
 * Fastify rate-limiting plugin.
 *
 * Register this plugin on a Fastify instance to apply rate limiting to all
 * routes. Attaches `RateLimit-*` headers to every response and automatically
 * sends a `429` reply when the client exceeds the configured limit.
 *
 * @example
 * ```ts
 * import Fastify from 'fastify';
 * import { fastifyRateLimit } from '@universal-rate-limit/fastify';
 *
 * const app = Fastify();
 * await app.register(fastifyRateLimit, { windowMs: 60_000, limit: 100 });
 * ```
 */
export const fastifyRateLimit = fp(rateLimitPlugin, {
    name: '@universal-rate-limit/fastify',
    fastify: '>=4.0.0'
});
