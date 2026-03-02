import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction, RequestHandler } from 'express';
import { rateLimit, buildRateLimitResponse } from 'universal-rate-limit';
import type { RateLimitOptions } from 'universal-rate-limit';

export type { RateLimitOptions, RateLimitResult, Store, IncrementResult, MemoryStore } from 'universal-rate-limit';

/** Rate limit options for the Express middleware adapter. */
export type ExpressRateLimitOptions = RateLimitOptions<ExpressRequest>;

/** Common proxy/CDN headers that carry the client's real IP address. */
const IP_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'fly-client-ip'];

/**
 * Default key generator for Express that reads client IP from well-known
 * proxy headers, falling back to Express's `req.ip` (which respects the
 * `trust proxy` setting).
 */
function expressDefaultKeyGenerator(req: ExpressRequest): string {
    for (const header of IP_HEADERS) {
        const value = req.headers[header];
        if (typeof value === 'string') {
            return value.split(',')[0].trim();
        }
    }
    return req.ip ?? '127.0.0.1';
}

/**
 * Create an Express rate-limiting middleware.
 *
 * Attaches `RateLimit-*` headers to every response and automatically
 * sends a `429` reply when the client exceeds the configured limit.
 *
 * @param options - Rate limit configuration (see {@link ExpressRateLimitOptions}).
 * @returns A standard Express {@link RequestHandler}.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { expressRateLimit } from '@universal-rate-limit/express';
 *
 * const app = express();
 * app.use(expressRateLimit({ windowMs: 60_000, limit: 100 }));
 * ```
 */
export function expressRateLimit(options: ExpressRateLimitOptions = {}): RequestHandler {
    const resolvedOptions: ExpressRateLimitOptions = {
        keyGenerator: expressDefaultKeyGenerator,
        ...options
    };
    const limiter = rateLimit<ExpressRequest>(resolvedOptions);

    return (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
        void (async () => {
            try {
                const result = await limiter(req);

                // Set rate limit headers
                for (const [key, value] of Object.entries(result.headers)) {
                    res.setHeader(key, value);
                }

                if (result.limited) {
                    const response = await buildRateLimitResponse<ExpressRequest>(req, result, {
                        handler: options.handler,
                        message: options.message,
                        statusCode: options.statusCode
                    });

                    res.status(response.status);
                    const body = await response.text();
                    const contentType = response.headers.get('content-type');
                    if (contentType) {
                        res.setHeader('Content-Type', contentType);
                    }
                    res.send(body);
                    return;
                }

                next();
            } catch (error) {
                next(error);
            }
        })();
    };
}
