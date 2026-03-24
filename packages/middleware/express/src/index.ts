import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction, RequestHandler } from 'express';
import { rateLimit, buildRateLimitResponse } from 'universal-rate-limit';
import type { RateLimitOptions, RateLimitResult } from 'universal-rate-limit';

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

/** Check if a value is a Promise (thenable). */
function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
    return typeof value === 'object' && value !== null && 'then' in value;
}

/** Apply a non-limited rate limit result to the Express response and call next. */
function applyResult(res: ExpressResponse, next: NextFunction, result: RateLimitResult): void {
    const headers = result.headers;
    for (const key in headers) {
        res.setHeader(key, headers[key]);
    }
    next();
}

/** Handle a rate-limited result (async — builds the 429 response). */
function handleLimited(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
    result: RateLimitResult,
    options: ExpressRateLimitOptions
): void {
    const headers = result.headers;
    for (const key in headers) {
        res.setHeader(key, headers[key]);
    }
    void buildRateLimitResponse<ExpressRequest>(req, result, {
        handler: options.handler,
        message: options.message,
        statusCode: options.statusCode
    })
        .then(response =>
            response.text().then(body => {
                const contentType = response.headers.get('content-type');
                res.status(response.status);
                if (contentType) {
                    res.setHeader('Content-Type', contentType);
                }
                res.send(body);
            })
        )
        .catch((error: unknown) => {
            next(error);
        });
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

    // Not async on purpose — when the core limiter returns synchronously
    // (e.g. MemoryStore), this avoids wrapping every request in a Promise.
    return (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
        const result = limiter(req);

        if (isPromise(result)) {
            result.then(
                r => {
                    if (r.limited) {
                        handleLimited(req, res, next, r, options);
                        return;
                    }
                    applyResult(res, next, r);
                },
                (error: unknown) => {
                    next(error);
                }
            );
            return;
        }

        // Synchronous fast path
        if (result.limited) {
            handleLimited(req, res, next, result, options);
            return;
        }

        applyResult(res, next, result);
    };
}
