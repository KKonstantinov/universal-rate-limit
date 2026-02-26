import { rateLimit, buildRateLimitResponse } from 'universal-rate-limit';
import type { RateLimitOptions, RateLimitResult } from 'universal-rate-limit';

export type { RateLimitOptions, RateLimitResult, Store, IncrementResult, MemoryStore } from 'universal-rate-limit';

export interface NextjsRateLimitOptions extends RateLimitOptions {
    keyGenerator?: (request: Request) => string | Promise<string>;
}

export type NextjsApiHandler = (request: Request) => Response | Promise<Response>;

/**
 * Wraps a Next.js App Router API route handler with rate limiting.
 * Works with Next.js route handlers (app/api/.../route.ts).
 */
export function withRateLimit(handler: NextjsApiHandler, options: NextjsRateLimitOptions = {}): NextjsApiHandler {
    const limiter = rateLimit(options);

    return async (request: Request): Promise<Response> => {
        const result = await limiter(request);

        if (result.limited) {
            return buildRateLimitResponse(request, result, {
                handler: options.handler,
                message: options.message,
                statusCode: options.statusCode
            });
        }

        const response = await handler(request);

        // Clone response to add rate limit headers
        const newHeaders = new Headers(response.headers);
        for (const [key, value] of Object.entries(result.headers)) {
            newHeaders.set(key, value);
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });
    };
}

/**
 * Creates a Next.js Edge Middleware-compatible rate limiter.
 * Returns a function that checks rate limits and returns either
 * a 429 response or null (to continue to the next middleware).
 */
export function nextjsRateLimit(options: NextjsRateLimitOptions = {}): (request: Request) => Promise<RateLimitResult> {
    return rateLimit(options);
}
