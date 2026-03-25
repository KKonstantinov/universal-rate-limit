import type { MiddlewareHandler } from 'hono';
import { rateLimit, buildRateLimitResponse } from 'universal-rate-limit';
import type { RateLimitOptions } from 'universal-rate-limit';

export type {
    RateLimitOptions,
    RateLimitResult,
    Store,
    ConsumeResult,
    Algorithm,
    AlgorithmConfig,
    MemoryStoreOptions
} from 'universal-rate-limit';
export { MemoryStore, fixedWindow, slidingWindow, tokenBucket } from 'universal-rate-limit';

/** Rate limit options for the Hono middleware adapter. */
export type HonoRateLimitOptions = RateLimitOptions;

/**
 * Create a Hono rate-limiting middleware.
 *
 * Attaches `RateLimit-*` headers to every response and automatically
 * sends a `429` reply when the client exceeds the configured limit.
 *
 * @param options - Rate limit configuration (see {@link HonoRateLimitOptions}).
 * @returns A Hono {@link MiddlewareHandler}.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { honoRateLimit } from '@universal-rate-limit/hono';
 *
 * const app = new Hono();
 * app.use('*', honoRateLimit({ windowMs: 60_000, limit: 100 }));
 * ```
 */
export function honoRateLimit(options: HonoRateLimitOptions = {}): MiddlewareHandler {
    const limiter = rateLimit(options);

    return async (c, next) => {
        const result = await limiter(c.req.raw);

        // Set rate limit headers on the response
        for (const [key, value] of Object.entries(result.headers)) {
            c.header(key, value);
        }

        if (result.limited) {
            const response = await buildRateLimitResponse(c.req.raw, result, {
                handler: options.handler,
                message: options.message,
                statusCode: options.statusCode
            });

            c.status(response.status as Parameters<typeof c.status>[0]);
            const contentType = response.headers.get('content-type');
            if (contentType) {
                c.header('content-type', contentType);
            }
            return c.body(await response.text());
        }

        await next();
    };
}
