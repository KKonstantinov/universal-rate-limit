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

/** Rate limit options for the Next.js middleware adapters. */
export type NextjsRateLimitOptions = RateLimitOptions;

/**
 * Signature for a Next.js App Router route handler
 * (`app/api/.../route.ts` exports).
 */
export type NextjsApiHandler = (request: Request) => Response | Promise<Response>;

/**
 * Wrap a Next.js App Router route handler with rate limiting.
 *
 * The returned handler evaluates the rate limit before calling the original
 * handler. If the limit is exceeded a `429` response is returned immediately;
 * otherwise `RateLimit-*` headers are added to the original response.
 *
 * @param handler - The route handler to wrap (`GET`, `POST`, etc.).
 * @param options - Rate limit configuration (see {@link NextjsRateLimitOptions}).
 * @returns A rate-limited {@link NextjsApiHandler}.
 *
 * @example
 * ```ts
 * // app/api/hello/route.ts
 * import { withRateLimit } from '@universal-rate-limit/nextjs';
 *
 * const handler = (req: Request) => Response.json({ hello: 'world' });
 * export const GET = withRateLimit(handler, { windowMs: 60_000, limit: 30 });
 * ```
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
 * Create a rate limiter for use inside Next.js Edge Middleware.
 *
 * Returns the core limiter function directly. Use the returned
 * {@link RateLimitResult} to decide whether to continue or respond
 * with a `429` in your `middleware.ts`.
 *
 * @param options - Rate limit configuration (see {@link NextjsRateLimitOptions}).
 * @returns An async function `(request: Request) => Promise<RateLimitResult>`.
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { nextjsRateLimit } from '@universal-rate-limit/nextjs';
 * import { NextResponse } from 'next/server';
 *
 * const limiter = nextjsRateLimit({ windowMs: 60_000, limit: 100 });
 *
 * export async function middleware(request: Request) {
 *   const result = await limiter(request);
 *   if (result.limited) return new Response('Too Many Requests', { status: 429 });
 *   return NextResponse.next();
 * }
 * ```
 */
export function nextjsRateLimit(options: NextjsRateLimitOptions = {}): (request: Request) => RateLimitResult | Promise<RateLimitResult> {
    return rateLimit(options);
}
