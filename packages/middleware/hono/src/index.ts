import type { MiddlewareHandler } from 'hono';
import { rateLimit, buildRateLimitResponse } from 'universal-rate-limit';
import type { RateLimitOptions } from 'universal-rate-limit';

export type { RateLimitOptions, RateLimitResult, Store, IncrementResult, MemoryStore } from 'universal-rate-limit';

export interface HonoRateLimitOptions extends RateLimitOptions {
    keyGenerator?: (request: Request) => string | Promise<string>;
}

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
            return c.body(await response.text());
        }

        await next();
    };
}
