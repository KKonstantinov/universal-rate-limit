import type { Context, Env, MiddlewareHandler } from 'hono';
import { rateLimit, buildRateLimitResponse, extractClientIp } from 'universal-rate-limit';
import type { MaybePromise, RateLimitOptions, RateLimitResult } from 'universal-rate-limit';

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

/**
 * Rate limit options with typed Hono context as the final callback argument.
 * Existing callbacks receiving only a Request (or Request and result) remain supported.
 */
export interface HonoRateLimitOptions<E extends Env = Env> extends Omit<
    RateLimitOptions,
    'limit' | 'cost' | 'keyGenerator' | 'skip' | 'handler' | 'message'
> {
    /** Maximum allowance, optionally resolved from the request and authenticated context. */
    limit?: number | ((request: Request, context: Context<E>) => MaybePromise<number>);
    /** Units consumed per request, optionally resolved from typed context. */
    cost?: number | ((request: Request, context: Context<E>) => MaybePromise<number>);
    /** Counter key, optionally derived from identity set by earlier authentication middleware. */
    keyGenerator?: (request: Request, context: Context<E>) => MaybePromise<string>;
    /** Whether to bypass the limiter for this request and context. */
    skip?: (request: Request, context: Context<E>) => MaybePromise<boolean>;
    /** Custom refusal response; receives the original request, result and typed context. */
    handler?: (request: Request, result: RateLimitResult, context: Context<E>) => MaybePromise<Response>;
    /** Refusal message, optionally resolved from the original request, result and typed context. */
    message?:
        | string
        | Record<string, unknown>
        | ((request: Request, result: RateLimitResult, context: Context<E>) => string | Record<string, unknown>);
}

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
 * app.use('*', honoRateLimit({ algorithm: { type: 'sliding-window', windowMs: 60_000 }, limit: 100 }));
 * ```
 */
export function honoRateLimit<E extends Env = Env>(options: HonoRateLimitOptions<E> = {}): MiddlewareHandler<E> {
    const { limit, cost, keyGenerator, skip, handler, message, ...coreOptions } = options;
    // One core limiter/store per middleware instance; only the context varies per request.
    const limiter = rateLimit<Context<E>>({
        ...coreOptions,
        limit: typeof limit === 'function' ? c => limit(c.req.raw, c) : limit,
        cost: typeof cost === 'function' ? c => cost(c.req.raw, c) : cost,
        keyGenerator: c => (keyGenerator ? keyGenerator(c.req.raw, c) : extractClientIp(c.req.raw)),
        skip: skip ? c => skip(c.req.raw, c) : undefined
    });

    return async (c, next) => {
        const result = await limiter(c);
        let response: Response;
        let headers: Headers;

        if (result.limited) {
            response = await buildRateLimitResponse(c, result, {
                handler: handler ? (context, result) => handler(context.req.raw, result, context) : undefined,
                message: typeof message === 'function' ? (context, result) => message(context.req.raw, result, context) : message,
                statusCode: options.statusCode
            });
            // Read prepared or materialized upstream headers without merging the handler's
            // response through Hono again: c.json() already includes inherited cookies.
            headers = new Headers(c.newResponse(null).headers);
            const cookies = new Set([...headers.getSetCookie(), ...response.headers.getSetCookie()]);
            for (const [key, value] of response.headers) {
                if (key !== 'set-cookie') headers.set(key, value);
            }
            headers.delete('set-cookie');
            for (const cookie of cookies) headers.append('set-cookie', cookie);
        } else {
            await next();
            response = c.res;
            headers = new Headers(response.headers);
        }

        // Stamp the final response, including raw/error responses. Keep an inner limiter's policy
        // authoritative when this limiter admitted the request but a later limiter refused it.
        for (const [key, value] of Object.entries(result.headers)) {
            if (result.limited || !headers.has(key)) headers.set(key, value);
        }
        // Passing the original Response also preserves runtime-specific initializer state,
        // such as Workers WebSocket upgrades and compression metadata.
        const finalResponse = new Response(response.body, response);
        const originalHeaderNames = [...finalResponse.headers.keys()];
        for (const key of originalHeaderNames) finalResponse.headers.delete(key);
        for (const [key, value] of headers) finalResponse.headers.append(key, value);
        // Hono's setter otherwise merges old headers over the custom values. Clearing first also
        // avoids mutating immutable redirect/fetch headers on earlier supported Hono 4 releases.
        c.res = undefined;
        c.res = finalResponse;
    };
}
