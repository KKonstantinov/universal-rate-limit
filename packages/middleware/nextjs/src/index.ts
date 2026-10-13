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
export { MemoryStore, fixedWindow, slidingWindow, tokenBucket, IP_HEADERS, extractClientIp } from 'universal-rate-limit';

/** Rate limit options for the Next.js middleware adapters. */
export type NextjsRateLimitOptions = RateLimitOptions;

/**
 * Signature for a Next.js App Router route handler
 * (`app/api/.../route.ts` exports). `context` is the second argument Next.js
 * passes to route handlers, e.g. `{ params: Promise<{ id: string }> }` for
 * dynamic routes.
 */
export type NextjsApiHandler<TContext = unknown> = (request: Request, context: TContext) => Response | Promise<Response>;

/**
 * Wrap a Next.js App Router route handler with rate limiting.
 *
 * The returned handler evaluates the rate limit before calling the original
 * handler. If the limit is exceeded a `429` response is returned immediately;
 * otherwise `RateLimit-*` headers are added to the original response. The
 * route context (dynamic `params`) is forwarded to the original handler.
 *
 * @param handler - The route handler to wrap (`GET`, `POST`, etc.).
 * @param options - Rate limit configuration (see {@link NextjsRateLimitOptions}).
 * @returns A rate-limited route handler.
 *
 * @example
 * ```ts
 * // app/api/users/[id]/route.ts
 * import { withRateLimit } from '@universal-rate-limit/nextjs';
 *
 * async function handler(request: Request, { params }: { params: Promise<{ id: string }> }) {
 *   const { id } = await params;
 *   return Response.json({ id });
 * }
 *
 * export const GET = withRateLimit(handler, { limit: 30, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
 * ```
 */
export function withRateLimit<TContext = unknown>(
    handler: NextjsApiHandler<TContext>,
    options: NextjsRateLimitOptions = {}
): (request: Request, context?: TContext) => Promise<Response> {
    const limiter = rateLimit(options);

    return async (request: Request, context?: TContext): Promise<Response> => {
        const result = await limiter(request);

        if (result.limited) {
            return buildRateLimitResponse(request, result, {
                handler: options.handler,
                message: options.message,
                statusCode: options.statusCode
            });
        }

        // Next.js always passes the context; it is optional only for direct callers (e.g. tests)
        const response = await handler(request, context as TContext);

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
 * Create a rate limiter for use in Next.js `proxy.ts` (Next.js 16) or
 * `middleware.ts` (Next.js 14/15), or inside a route handler.
 *
 * Returns the core limiter function directly. Use the returned
 * {@link RateLimitResult} to decide whether to continue or respond
 * with a `429`.
 *
 * @param options - Rate limit configuration (see {@link NextjsRateLimitOptions}).
 * @returns A function `(request: Request) => RateLimitResult | Promise<RateLimitResult>`.
 *
 * @example
 * ```ts
 * // proxy.ts
 * import { nextjsRateLimit } from '@universal-rate-limit/nextjs';
 * import { NextResponse } from 'next/server';
 *
 * const limiter = nextjsRateLimit({ limit: 100, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
 *
 * export async function proxy(request: Request) {
 *   const result = await limiter(request);
 *   if (result.limited) return new Response('Too Many Requests', { status: 429, headers: result.headers });
 *   return NextResponse.next();
 * }
 * ```
 */
export function nextjsRateLimit(options: NextjsRateLimitOptions = {}): (request: Request) => RateLimitResult | Promise<RateLimitResult> {
    return rateLimit(options);
}
