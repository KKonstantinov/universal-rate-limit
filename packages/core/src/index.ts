// ── Types ────────────────────────────────────────────────────────────────────

/** A value that may or may not be wrapped in a Promise. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * The result of consuming rate limit capacity.
 *
 * Returned by {@link Algorithm.consume}, {@link Store.consume}, and used
 * internally by {@link rateLimit} to build {@link RateLimitResult}.
 */
export interface ConsumeResult {
    /** Whether the request exceeded the allowed limit. `true` means the request should be rejected. */
    limited: boolean;
    /** How many requests remain before the limit is reached. Always `>= 0`. */
    remaining: number;
    /** The time at which capacity will be fully restored (window reset or bucket refill). */
    resetTime: Date;
    /** Milliseconds the client should wait before retrying. `0` when not limited. */
    retryAfterMs: number;
}

/**
 * A rate limiting algorithm that manages opaque state and produces
 * {@link ConsumeResult}s. Algorithms are pure — given the same inputs
 * they produce the same outputs.
 *
 * Built-in implementations are created via {@link fixedWindow},
 * {@link slidingWindow}, and {@link tokenBucket}. Custom algorithms
 * can be passed directly to {@link rateLimit}.
 *
 * @typeParam TState - The internal state type managed by this algorithm.
 */
export interface Algorithm<TState = unknown> {
    /**
     * Unique name identifying this algorithm (e.g. `'fixed-window'`, `'sliding-window'`, `'token-bucket'`).
     * Used by RedisStore to select the correct Lua script.
     */
    name: string;

    /**
     * Algorithm parameters exposed as a key-value map.
     *
     * Used by RedisStore to pass ARGV to Lua scripts, and by header
     * generation to compute the `w=` policy parameter. Built-in algorithms
     * include keys like `windowMs`, `refillRate`, and optionally `bucketSize`.
     */
    config: Record<string, unknown>;

    /**
     * Consume capacity and return the updated state with the result.
     *
     * @param state - The current algorithm state, or `undefined` for first request.
     * @param limit - The maximum number of requests allowed in the window.
     * @param nowMs - The current time in milliseconds since epoch.
     * @param cost - Number of units to consume. @default 1
     * @returns An object with `next` (the new state) and `result` (the {@link ConsumeResult}).
     */
    consume(
        state: TState | undefined,
        limit: number,
        nowMs: number,
        cost?: number
    ): {
        next: TState;
        result: ConsumeResult;
    };

    /**
     * Read-only peek at the current state without consuming any capacity.
     *
     * @param state - The current algorithm state, or `undefined` if no state exists.
     * @param limit - The maximum number of requests allowed in the window.
     * @param nowMs - The current time in milliseconds since epoch.
     * @returns A {@link ConsumeResult} reflecting the current state.
     */
    peek?(state: TState | undefined, limit: number, nowMs: number): ConsumeResult;

    /**
     * Reverse a previous {@link consume} by restoring capacity.
     *
     * Used by {@link Store.unconsume} to implement undo workflows.
     * All built-in algorithms implement this method.
     *
     * @param state - The current algorithm state to modify.
     * @param limit - The maximum number of requests allowed in the window.
     * @param nowMs - The current time in milliseconds since epoch.
     * @param cost - Number of units to restore. @default 1
     * @returns The updated state with capacity restored.
     */
    unconsume?(state: TState, limit: number, nowMs: number, cost?: number): TState;

    /**
     * Maximum TTL in milliseconds for entries using this algorithm.
     * Used by {@link MemoryStore} to set expiry on stored state.
     *
     * @param limit - The configured rate limit (used by token-bucket to compute refill time).
     * @returns TTL in milliseconds.
     */
    ttlMs(limit: number): number;
}

/**
 * Discriminated union of built-in algorithm configurations.
 * Passed to `rateLimit({ algorithm })` and resolved to an {@link Algorithm} internally.
 *
 * - `{ type: 'fixed-window', windowMs }` — simple counter that resets after each window.
 * - `{ type: 'sliding-window', windowMs }` — weighted counter that smooths burst edges across windows.
 * - `{ type: 'token-bucket', refillRate, bucketSize?, refillMs? }` — bucket that refills at a steady rate;
 *   `bucketSize` defaults to the configured `limit` when omitted. `refillMs` is the interval over
 *   which `refillRate` tokens are added (default `1000`, i.e. tokens per second).
 */
export type AlgorithmConfig =
    | { type: 'fixed-window'; windowMs: number }
    | { type: 'sliding-window'; windowMs: number }
    | { type: 'token-bucket'; refillRate: number; bucketSize?: number; refillMs?: number };

/**
 * Backend store interface for persisting rate limit state.
 *
 * Implementations must be safe for concurrent access. The built-in
 * {@link MemoryStore} is suitable for single-process deployments;
 * use a Redis-backed store for distributed environments.
 */
export interface Store {
    /** Key prefix prepended to every rate limit key in the store. */
    prefix?: string;

    /**
     * Consume capacity for the given key using the provided algorithm.
     *
     * @param key - The rate limit key (e.g. client IP).
     * @param algorithm - The algorithm that manages state transitions.
     * @param limit - Maximum allowed requests in the window.
     * @param cost - Units to consume. @default 1
     * @returns The {@link ConsumeResult} after consumption.
     */
    consume(key: string, algorithm: Algorithm, limit: number, cost?: number): MaybePromise<ConsumeResult>;

    /**
     * Peek at the current state without consuming any capacity.
     *
     * @param key - The rate limit key.
     * @param algorithm - The algorithm that manages state transitions.
     * @param limit - Maximum allowed requests in the window.
     * @returns The current {@link ConsumeResult}, or `undefined` if no state exists for the key.
     */
    peek?(key: string, algorithm: Algorithm, limit: number): MaybePromise<ConsumeResult | undefined>;

    /**
     * Reverse a previous {@link consume} by restoring capacity.
     *
     * @param key - The rate limit key.
     * @param algorithm - The algorithm that manages state transitions (must implement {@link Algorithm.unconsume}).
     * @param limit - Maximum allowed requests in the window.
     * @param cost - Units to restore. @default 1
     */
    unconsume?(key: string, algorithm: Algorithm, limit: number, cost?: number): MaybePromise<void>;

    /**
     * Remove all rate limit data for a single key.
     *
     * @param key - The rate limit key to reset.
     */
    resetKey(key: string): MaybePromise<void>;

    /** Remove all rate limit data for every key in the store. */
    resetAll(): MaybePromise<void>;

    /** Release any resources held by the store (timers, connections, etc.). */
    shutdown?(): MaybePromise<void>;
}

/**
 * The IETF RateLimit header draft version to emit.
 *
 * - `'draft-6'` — separate `RateLimit-Limit`, `RateLimit-Remaining`, and
 *   `RateLimit-Reset` headers.
 * - `'draft-7'` — combined `RateLimit` and `RateLimit-Policy` headers using
 *   Structured Fields syntax.
 */
export type HeadersVersion = 'draft-6' | 'draft-7';

/** Configuration options for the rate limiter. */
export interface RateLimitOptions<TRequest = Request> {
    /** Duration of the rate limit window in milliseconds. Sugar for sliding-window default. @default 60_000 */
    windowMs?: number;
    /**
     * Maximum number of requests allowed per window. Can be a static number
     * or an async function that resolves per-request (useful for per-user limits).
     * @default 60
     */
    limit?: number | ((request: TRequest) => number | Promise<number>);
    /**
     * Function that derives a unique key for the incoming request.
     * Requests sharing the same key share a rate limit counter.
     * @default IP-based key extracted from common proxy headers
     */
    keyGenerator?: (request: TRequest) => string | Promise<string>;
    /**
     * The backing store used to track rate limit state. When omitted, an in-memory
     * {@link MemoryStore} is created automatically.
     */
    store?: Store;
    /** The algorithm. Accepts a config object OR a raw Algorithm instance. @default sliding-window with windowMs */
    algorithm?: AlgorithmConfig | Algorithm;
    /** The IETF RateLimit header draft version to emit. @default 'draft-7' */
    headers?: HeadersVersion;
    /**
     * When `true`, include non-standard `X-RateLimit-Limit`,
     * `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers alongside
     * the standard headers. Widely used by GitHub, Twitter, etc.
     * @default false
     */
    legacyHeaders?: boolean;
    /**
     * Custom handler invoked when a request is rate-limited. Return a `Response`
     * to fully control the 429 reply. When omitted, a default response is built
     * from {@link message} and {@link statusCode}.
     */
    handler?: (request: TRequest, result: RateLimitResult) => Response | Promise<Response>;
    /**
     * The body sent when a request is rate-limited. Can be a plain string, a
     * JSON-serializable object, or an async function returning either.
     * @default 'Too Many Requests'
     */
    message?: string | Record<string, unknown> | ((request: TRequest, result: RateLimitResult) => string | Record<string, unknown>);
    /** HTTP status code for rate-limited responses. @default 429 */
    statusCode?: number;
    /**
     * Return `true` to bypass rate limiting for the given request.
     * Skipped requests receive full remaining quota in their headers.
     */
    skip?: (request: TRequest) => boolean | Promise<boolean>;
    /**
     * When `true`, store errors are swallowed and the request is allowed
     * through (fail-open). When `false`, store errors propagate as exceptions.
     * @default false
     */
    passOnStoreError?: boolean;
    /**
     * Number of units to consume per request. Can be a static number or an
     * async function that resolves per-request (useful for weighted endpoints).
     * @default 1
     */
    cost?: number | ((request: TRequest) => number | Promise<number>);
}

/** The outcome of evaluating a request against the rate limiter. */
export interface RateLimitResult {
    /** Whether the request exceeded the allowed limit. */
    limited: boolean;
    /** The maximum number of requests allowed in the current window. */
    limit: number;
    /** How many requests remain before the limit is reached. */
    remaining: number;
    /** The time at which the current rate limit window resets. */
    resetTime: Date;
    /**
     * Pre-formatted RateLimit headers to attach to the response.
     *
     * Always includes the IETF RateLimit headers for the configured draft version.
     * When {@link limited} is `true`, a
     * {@link https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3 | Retry-After}
     * header (RFC 9110 §10.2.3) is also included using the delay-seconds format.
     */
    headers: Record<string, string>;
}

// ── Default key generator ────────────────────────────────────────────────────

/** Common proxy/CDN headers that carry the client's real IP address. */
const IP_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'fly-client-ip'] as const;

/**
 * Default key generator that extracts the client IP from well-known proxy
 * headers. Falls back to `'127.0.0.1'` when no header is present.
 */
function defaultKeyGenerator(request: Request): string {
    for (const header of IP_HEADERS) {
        const value = request.headers.get(header);
        if (value) {
            return value.split(',')[0].trim();
        }
    }
    return '127.0.0.1';
}

// ── Header generation ────────────────────────────────────────────────────────

/**
 * Build RateLimit response headers according to the specified IETF draft version.
 *
 * - **draft-7** (default): Emits a combined `RateLimit` header with `limit`, `remaining`, and `reset`
 *   fields, plus a `RateLimit-Policy` header (RFC 9110 §15.5.29).
 * - **draft-6**: Emits separate `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers.
 *
 * When `limited` is `true`, a `Retry-After` header (delay-seconds, per RFC 9110 §10.2.3) is included.
 * When `legacyHeaders` is `true`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
 * `X-RateLimit-Reset` headers are added alongside the standard headers.
 *
 * @param version - IETF draft version controlling header format.
 * @param limit - Maximum number of requests allowed in the window.
 * @param remaining - Requests remaining before the limit is reached.
 * @param resetTimeMs - Timestamp (ms since epoch) when the current window resets.
 * @param nowMs - Current timestamp (ms since epoch), used to compute `reset` as a delta.
 * @param windowSeconds - Window duration in seconds, used to build the `w=` policy parameter.
 * @param legacyHeaders - Whether to include `X-RateLimit-*` headers.
 * @param limited - Whether the current request has been rate-limited (triggers `Retry-After`).
 * @param retryAfterSeconds - Seconds the client should wait before retrying.
 * @param policyHeader - Optional override for the `RateLimit-Policy` header value (draft-7 only).
 * @returns A record of header name–value pairs ready to be set on the response.
 */
function generateHeaders(
    version: HeadersVersion,
    limit: number,
    remaining: number,
    resetTimeMs: number,
    nowMs: number,
    windowSeconds: number,
    legacyHeaders: boolean,
    limited: boolean,
    retryAfterSeconds: number,
    policyHeader?: string
): Record<string, string> {
    const resetSeconds = Math.max(0, Math.ceil((resetTimeMs - nowMs) / 1000));
    const clampedRemaining = String(Math.max(0, remaining));

    const headers: Record<string, string> =
        version === 'draft-6'
            ? {
                  'RateLimit-Limit': String(limit),
                  'RateLimit-Remaining': clampedRemaining,
                  'RateLimit-Reset': String(resetSeconds)
              }
            : {
                  RateLimit: 'limit=' + String(limit) + ', remaining=' + clampedRemaining + ', reset=' + String(resetSeconds),
                  'RateLimit-Policy': policyHeader ?? String(limit) + ';w=' + String(windowSeconds)
              };

    // RFC 9110 §10.2.3 — Retry-After (delay-seconds)
    if (limited) {
        headers['Retry-After'] = String(retryAfterSeconds);
    }

    if (legacyHeaders) {
        headers['X-RateLimit-Limit'] = String(limit);
        headers['X-RateLimit-Remaining'] = clampedRemaining;
        headers['X-RateLimit-Reset'] = String(resetSeconds);
    }

    return headers;
}

// ── Algorithm factories ──────────────────────────────────────────────────────

/** Internal state for the fixed-window algorithm. */
interface FixedWindowState {
    /** Number of hits recorded in the current window. */
    hits: number;
    /** Timestamp (ms since epoch) when the current window started. */
    windowStart: number;
}

/**
 * Create a fixed-window rate limiting algorithm.
 *
 * The window starts from each user's first request (per-user windows).
 * When the window expires, the counter resets to zero.
 *
 * @param options - `{ windowMs }` — window duration in milliseconds.
 * @returns An {@link Algorithm} that implements fixed-window rate limiting.
 */
export function fixedWindow(options: { windowMs: number }): Algorithm<FixedWindowState> {
    const { windowMs } = options;
    return {
        name: 'fixed-window',
        config: { windowMs },

        consume(state: FixedWindowState | undefined, limit: number, nowMs: number, cost = 1) {
            const next: FixedWindowState =
                !state || nowMs >= state.windowStart + windowMs
                    ? { hits: cost, windowStart: nowMs }
                    : { hits: state.hits + cost, windowStart: state.windowStart };

            const resetTime = new Date(next.windowStart + windowMs);
            const limited = next.hits > limit;
            const remaining = Math.max(0, limit - next.hits);
            const retryAfterMs = limited ? Math.max(0, next.windowStart + windowMs - nowMs) : 0;

            return { next, result: { limited, remaining, resetTime, retryAfterMs } };
        },

        unconsume(state: FixedWindowState, _limit: number, _nowMs: number, cost = 1): FixedWindowState {
            return { hits: Math.max(0, state.hits - cost), windowStart: state.windowStart };
        },

        peek(state: FixedWindowState | undefined, limit: number, nowMs: number) {
            if (!state || nowMs >= state.windowStart + windowMs) {
                return { limited: false, remaining: limit, resetTime: new Date(nowMs + windowMs), retryAfterMs: 0 };
            }
            const limited = state.hits > limit;
            const remaining = Math.max(0, limit - state.hits);
            const retryAfterMs = limited ? Math.max(0, state.windowStart + windowMs - nowMs) : 0;
            return { limited, remaining, resetTime: new Date(state.windowStart + windowMs), retryAfterMs };
        },

        ttlMs() {
            return windowMs;
        }
    };
}

/** Internal state for the sliding-window algorithm. */
interface SlidingWindowState {
    /** Number of hits recorded in the current window. */
    currentHits: number;
    /** Number of hits recorded in the previous (expired) window, used for weighted interpolation. */
    previousHits: number;
    /** Timestamp (ms since epoch) when the current window started. */
    windowStart: number;
}

/**
 * Create a sliding-window rate limiting algorithm.
 *
 * Smooths burst edges by weighting the previous window's count into the
 * current window: `totalHits = ceil(previousHits * weight + currentHits)`
 * where `weight` decays linearly from 1 to 0 over the current window.
 *
 * @param options - `{ windowMs }` — window duration in milliseconds.
 * @returns An {@link Algorithm} that implements sliding-window rate limiting.
 */
export function slidingWindow(options: { windowMs: number }): Algorithm<SlidingWindowState> {
    const { windowMs } = options;

    /**
     * Compute the effective hit count by blending the previous and current windows.
     *
     * The formula is: `ceil(previousHits * weight + currentHits)`
     *
     * `weight` decays linearly from 1 → 0 as time progresses through the current window:
     *   `weight = 1 - elapsed / windowMs`
     *
     * At the start of the window (`elapsed = 0`), previous hits count fully.
     * At the end (`elapsed = windowMs`), they contribute nothing.
     * `ceil()` rounds up so we never under-count and accidentally allow an extra request.
     */
    function computeWeightedTotal(state: SlidingWindowState, nowMs: number): number {
        if (state.previousHits === 0) return state.currentHits;
        const elapsed = nowMs - state.windowStart;
        const weight = Math.max(0, 1 - elapsed / windowMs);
        return Math.ceil(state.previousHits * weight + state.currentHits);
    }

    /**
     * Calculate how long a limited client must wait before a retry (cost=1) would succeed.
     *
     * We need to find the earliest time `t` where:
     *   `ceil(prevHits(t) * weight(t) + currentHits(t) + 1) <= limit`
     *
     * The +1 accounts for the retry request itself adding a hit.
     *
     * **Case 1 — Recovery within the current window (previous hits decay enough):**
     *   The previous window's contribution decays as `prevHits * (1 - elapsed/windowMs)`.
     *   We solve for when `prevHits * weight <= limit - 1 - currentHits`:
     *     `targetWeight = (limit - 1 - currentHits) / prevHits`
     *     `targetElapsed = windowMs * (1 - targetWeight)`
     *   This case applies when `currentHits < limit` (there's room if previous hits shrink).
     *
     * **Case 2 — Recovery requires window rotation (current hits alone >= limit):**
     *   Current hits won't shrink within this window, so we must wait for rotation,
     *   at which point `currentHits` becomes `previousHits` in the next window and decays.
     *   We solve for when `currentHits * weight_new + 1 <= limit` in the next window:
     *     `targetWeight = (limit - 1) / currentHits`
     *     `targetElapsed = windowMs * (1 - targetWeight)`
     *     `retryAt = resetTime + targetElapsed`
     *   If `currentHits <= limit - 1`, recovery happens immediately at rotation.
     */
    function computeRetryAfterMs(state: SlidingWindowState, limit: number, nowMs: number): number {
        const { currentHits, previousHits, windowStart } = state;
        const resetTimeMs = windowStart + windowMs;

        // Room needed: a retry adds +1 hit, so prevHits * weight must fit within this budget
        const threshold = limit - 1 - currentHits;

        // Case 1: Previous hits are decaying and current hits leave room — solve within this window
        if (previousHits > 0 && threshold >= 0) {
            const targetWeight = threshold / previousHits;
            if (targetWeight >= 1) return 0; // Previous contribution already small enough
            const targetElapsed = windowMs * (1 - targetWeight);
            const retryAtMs = windowStart + targetElapsed;
            if (retryAtMs > nowMs) return retryAtMs - nowMs;
            return 0;
        }

        // Case 2: Current hits alone fill the limit — must wait for window rotation + decay
        if (currentHits === 0) return 0;

        const targetNewWeight = (limit - 1) / currentHits;
        if (targetNewWeight >= 1) {
            // Current hits fit under limit after rotation — recover at resetTime
            return Math.max(0, resetTimeMs - nowMs);
        }

        // Need additional decay time in the next window after rotation
        const targetElapsedNew = windowMs * (1 - targetNewWeight);
        return Math.max(0, resetTimeMs + targetElapsedNew - nowMs);
    }

    return {
        name: 'sliding-window',
        config: { windowMs },

        consume(state: SlidingWindowState | undefined, limit: number, nowMs: number, cost = 1) {
            // Window rotation: windows are aligned to the first request's timestamp, not the clock.
            // On rotation, currentHits moves to previousHits (so it can decay via weight),
            // and currentHits resets. After 2+ windows of inactivity, all history is discarded.
            let next: SlidingWindowState;

            if (!state) {
                next = { currentHits: cost, previousHits: 0, windowStart: nowMs };
            } else if (nowMs >= state.windowStart + windowMs * 2) {
                // Two+ windows elapsed — all previous data is stale
                next = { currentHits: cost, previousHits: 0, windowStart: nowMs };
            } else if (nowMs >= state.windowStart + windowMs) {
                // One window elapsed — rotate current → previous, advance windowStart by exactly
                // one windowMs (not to nowMs) to keep windows aligned to the original start time
                next = { currentHits: cost, previousHits: state.currentHits, windowStart: state.windowStart + windowMs };
            } else {
                next = { currentHits: state.currentHits + cost, previousHits: state.previousHits, windowStart: state.windowStart };
            }

            const totalHits = computeWeightedTotal(next, nowMs);
            const limited = totalHits > limit;
            const remaining = Math.max(0, limit - totalHits);
            const resetTime = new Date(next.windowStart + windowMs);
            const retryAfterMs = limited ? computeRetryAfterMs(next, limit, nowMs) : 0;

            return { next, result: { limited, remaining, resetTime, retryAfterMs } };
        },

        unconsume(state: SlidingWindowState, _limit: number, _nowMs: number, cost = 1): SlidingWindowState {
            return { currentHits: Math.max(0, state.currentHits - cost), previousHits: state.previousHits, windowStart: state.windowStart };
        },

        peek(state: SlidingWindowState | undefined, limit: number, nowMs: number) {
            if (!state) {
                return { limited: false, remaining: limit, resetTime: new Date(nowMs + windowMs), retryAfterMs: 0 };
            }

            // Simulate the same window rotation as consume(), but with currentHits: 0
            // since peek doesn't record a hit — just observes the current weighted total
            let effective: SlidingWindowState;
            if (nowMs >= state.windowStart + windowMs * 2) {
                effective = { currentHits: 0, previousHits: 0, windowStart: nowMs };
            } else if (nowMs >= state.windowStart + windowMs) {
                effective = { currentHits: 0, previousHits: state.currentHits, windowStart: state.windowStart + windowMs };
            } else {
                effective = state;
            }

            const totalHits = computeWeightedTotal(effective, nowMs);
            const limited = totalHits > limit;
            const remaining = Math.max(0, limit - totalHits);
            const resetTime = new Date(effective.windowStart + windowMs);
            const retryAfterMs = limited ? computeRetryAfterMs(effective, limit, nowMs) : 0;

            return { limited, remaining, resetTime, retryAfterMs };
        },

        ttlMs() {
            return windowMs * 2;
        }
    };
}

/** Internal state for the token-bucket algorithm. */
interface TokenBucketState {
    /** Number of tokens currently available in the bucket. */
    tokens: number;
    /** Timestamp (ms since epoch) when tokens were last refilled. */
    lastRefillMs: number;
}

/**
 * Create a token-bucket rate limiting algorithm.
 *
 * The bucket starts full (at `bucketSize` or `limit` tokens) and deducts
 * tokens per request. Tokens refill at `refillRate` tokens per `refillMs`
 * milliseconds, capped at bucket capacity.
 *
 * @param options - `{ refillRate, bucketSize?, refillMs? }` — tokens refilled per interval,
 *   optional bucket capacity, optional refill interval (default `1000` ms).
 * @returns An {@link Algorithm} that implements token-bucket rate limiting.
 */
export function tokenBucket(options: { refillRate: number; bucketSize?: number; refillMs?: number }): Algorithm<TokenBucketState> {
    const { refillRate, bucketSize } = options;
    const refillMs = options.refillMs ?? 1000;
    const tokensPerMs = refillRate / refillMs;
    return {
        name: 'token-bucket',
        config: bucketSize == null ? { refillRate, refillMs } : { refillRate, refillMs, bucketSize },

        consume(state: TokenBucketState | undefined, limit: number, nowMs: number, cost = 1) {
            const capacity = bucketSize ?? limit;
            let tokens: number;

            if (state) {
                // Refill tokens based on elapsed time
                const elapsed = nowMs - state.lastRefillMs;
                const refilled = elapsed * tokensPerMs;
                tokens = Math.min(capacity, state.tokens + refilled);

                // Try to consume
                if (tokens >= cost) {
                    tokens -= cost;
                } else {
                    // Not enough tokens — limited
                    const retryAfterMs = Math.ceil((cost - tokens) / tokensPerMs);
                    const resetTime = new Date(nowMs + Math.ceil((capacity - tokens) / tokensPerMs));
                    const next: TokenBucketState = { tokens, lastRefillMs: nowMs };
                    return { next, result: { limited: true, remaining: 0, resetTime, retryAfterMs } };
                }
            } else {
                // First request — bucket starts full, deduct cost
                if (capacity < cost) {
                    const retryAfterMs = Math.ceil((cost - capacity) / tokensPerMs);
                    const resetTime = new Date(nowMs + Math.ceil(capacity / tokensPerMs));
                    const next: TokenBucketState = { tokens: capacity, lastRefillMs: nowMs };
                    return { next, result: { limited: true, remaining: 0, resetTime, retryAfterMs } };
                }
                tokens = capacity - cost;
            }

            const remaining = Math.max(0, Math.floor(tokens));
            const resetTime = new Date(nowMs + Math.ceil((capacity - tokens) / tokensPerMs));
            const next: TokenBucketState = { tokens, lastRefillMs: nowMs };

            return { next, result: { limited: false, remaining, resetTime, retryAfterMs: 0 } };
        },

        unconsume(state: TokenBucketState, limit: number, _nowMs: number, cost = 1): TokenBucketState {
            const capacity = bucketSize ?? limit;
            return { tokens: Math.min(capacity, state.tokens + cost), lastRefillMs: state.lastRefillMs };
        },

        peek(state: TokenBucketState | undefined, limit: number, nowMs: number) {
            const capacity = bucketSize ?? limit;
            if (!state) {
                return { limited: false, remaining: capacity, resetTime: new Date(nowMs), retryAfterMs: 0 };
            }

            const elapsed = nowMs - state.lastRefillMs;
            const refilled = elapsed * tokensPerMs;
            const tokens = Math.min(capacity, state.tokens + refilled);
            const remaining = Math.max(0, Math.floor(tokens));
            const limited = tokens < 1;
            const retryAfterMs = limited ? Math.ceil((1 - tokens) / tokensPerMs) : 0;
            const resetTime = new Date(nowMs + Math.ceil((capacity - tokens) / tokensPerMs));

            return { limited, remaining, resetTime, retryAfterMs };
        },

        ttlMs(limit: number) {
            const capacity = bucketSize ?? limit;
            return Math.ceil(capacity / tokensPerMs);
        }
    };
}

// ── Algorithm resolution ─────────────────────────────────────────────────────

/** Resolve an algorithm option to an Algorithm object. */
function resolveAlgorithm(options: RateLimitOptions): Algorithm {
    if (!options.algorithm) {
        return slidingWindow({ windowMs: options.windowMs ?? 60_000 });
    }
    // Guard against old string-style algorithm names
    if (typeof options.algorithm !== 'object') {
        const value: unknown = options.algorithm;
        throw new TypeError(
            `Invalid algorithm option: expected an AlgorithmConfig object like { type: 'fixed-window', windowMs: 60000 }, got ${typeof value === 'string' ? `"${value}"` : String(value)}`
        );
    }
    // Discriminated union config (AlgorithmConfig always has `type`)
    if ('type' in options.algorithm) {
        switch (options.algorithm.type) {
            case 'fixed-window': {
                return fixedWindow({ windowMs: options.algorithm.windowMs });
            }
            case 'sliding-window': {
                return slidingWindow({ windowMs: options.algorithm.windowMs });
            }
            case 'token-bucket': {
                return tokenBucket({
                    refillRate: options.algorithm.refillRate,
                    bucketSize: options.algorithm.bucketSize,
                    refillMs: options.algorithm.refillMs
                });
            }
        }
    }
    // Raw Algorithm object (custom/third-party) — has `name` + `consume` but no `type`
    if ('name' in options.algorithm && 'consume' in options.algorithm) {
        return options.algorithm;
    }
    throw new TypeError(
        'Invalid algorithm option: expected an AlgorithmConfig with a `type` field, or a raw Algorithm with `name` and `consume`'
    );
}

// ── MemoryStore ──────────────────────────────────────────────────────────────

/** Default cleanup interval for the MemoryStore (60 seconds). */
const MEMORY_STORE_CLEANUP_INTERVAL_MS = 60_000;

/** Internal entry in the MemoryStore. */
interface MemoryEntry {
    /** The algorithm-specific state stored for this key. */
    state: unknown;
    /** Timestamp (ms since epoch) after which this entry can be evicted during cleanup. */
    expiresAt: number;
}

/** Configuration options for {@link MemoryStore}. */
export interface MemoryStoreOptions {
    /** Key prefix prepended to every rate limit key. @default undefined */
    prefix?: string;
    /** Background cleanup interval in milliseconds. @default 60_000 */
    cleanupIntervalMs?: number;
}

/**
 * In-memory {@link Store} implementation backed by a single `Map`.
 *
 * The algorithm handles all state management; the store simply persists
 * the opaque state returned by {@link Algorithm.consume}.
 * A background interval evicts expired entries automatically.
 * Call {@link shutdown} to clear the interval when the store is no longer needed.
 *
 * **Note:** This store is per-process — it is not shared across cluster
 * workers or server instances. Use a Redis-backed store for distributed
 * deployments.
 */
export class MemoryStore implements Store {
    readonly prefix?: string;
    private readonly entries = new Map<string, MemoryEntry>();
    private timer: ReturnType<typeof setInterval> | undefined;

    /** @param options - Optional store configuration (prefix, cleanup interval). */
    constructor(options: MemoryStoreOptions = {}) {
        this.prefix = options.prefix || undefined;

        const cleanupMs = options.cleanupIntervalMs ?? MEMORY_STORE_CLEANUP_INTERVAL_MS;
        this.timer = setInterval(() => {
            this.cleanup();
        }, cleanupMs);

        // Allow the timer to not keep the process alive
        if (typeof this.timer === 'object' && 'unref' in this.timer) {
            this.timer.unref();
        }
    }

    /** @inheritdoc */
    consume(key: string, algorithm: Algorithm, limit: number, cost?: number): ConsumeResult {
        const prefixedKey = this.prefix ? this.prefix + key : key;
        const now = Date.now();
        const existing = this.entries.get(prefixedKey);
        const state = existing && existing.expiresAt > now ? existing.state : undefined;

        const { next, result } = algorithm.consume(state, limit, now, cost);
        this.entries.set(prefixedKey, { state: next, expiresAt: now + algorithm.ttlMs(limit) });

        return result;
    }

    /** @inheritdoc */
    peek(key: string, algorithm: Algorithm, limit: number): ConsumeResult | undefined {
        if (!algorithm.peek) return undefined;
        const prefixedKey = this.prefix ? this.prefix + key : key;
        const now = Date.now();
        const existing = this.entries.get(prefixedKey);
        if (!existing || existing.expiresAt <= now) return undefined;

        return algorithm.peek(existing.state, limit, now);
    }

    /** @inheritdoc */
    unconsume(key: string, algorithm: Algorithm, limit: number, cost?: number): void {
        if (!algorithm.unconsume) return;
        const prefixedKey = this.prefix ? this.prefix + key : key;
        const now = Date.now();
        const existing = this.entries.get(prefixedKey);
        if (!existing || existing.expiresAt <= now) return;

        const newState = algorithm.unconsume(existing.state, limit, now, cost);
        this.entries.set(prefixedKey, { state: newState, expiresAt: existing.expiresAt });
    }

    /** @inheritdoc */
    resetKey(key: string): void {
        const prefixedKey = this.prefix ? this.prefix + key : key;
        this.entries.delete(prefixedKey);
    }

    /** @inheritdoc */
    resetAll(): void {
        this.entries.clear();
    }

    /** @inheritdoc */
    shutdown(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    /** Evict expired entries. */
    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) {
                this.entries.delete(key);
            }
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Check if a value is a Promise (thenable). */
function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
    return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)['then'] === 'function';
}

// ── rateLimit factory ────────────────────────────────────────────────────────

/**
 * Create a framework-agnostic rate limiter function.
 *
 * Returns a function that accepts a Web API {@link Request} and
 * resolves to a {@link RateLimitResult} indicating whether the request
 * should be allowed or rejected. When the configured store is synchronous
 * (e.g. the built-in {@link MemoryStore}), the result is returned
 * synchronously — no Promises are created on the hot path.
 *
 * @param options - Configuration for the rate limiter. All fields are optional
 *   and have sensible defaults (60 requests per 60 s, sliding-window, in-memory store).
 * @returns A function `(request: Request) => RateLimitResult | Promise<RateLimitResult>`.
 *
 * @example
 * ```ts
 * const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 100 });
 * const result = await limiter(request);
 * if (result.limited) { \/* reject *\/ }
 * ```
 */
export function rateLimit<TRequest = Request>(
    options: RateLimitOptions<TRequest> = {}
): (request: TRequest) => RateLimitResult | Promise<RateLimitResult> {
    const limitOption = options.limit ?? 60;

    if (typeof limitOption === 'number' && limitOption < 0) {
        throw new RangeError(`limit must be a non-negative number, got ${String(limitOption)}`);
    }

    const algo = resolveAlgorithm(options as RateLimitOptions);

    // Validate algorithm-specific parameters
    if ('windowMs' in algo.config && Number(algo.config.windowMs) <= 0) {
        throw new RangeError(`windowMs must be a positive number, got ${String(algo.config.windowMs)}`);
    }
    if ('refillRate' in algo.config && Number(algo.config.refillRate) <= 0) {
        throw new RangeError(`refillRate must be a positive number, got ${String(algo.config.refillRate)}`);
    }
    if ('refillMs' in algo.config && Number(algo.config.refillMs) <= 0) {
        throw new RangeError(`refillMs must be a positive number, got ${String(algo.config.refillMs)}`);
    }

    const costOption = options.cost ?? 1;
    const keyGenerator = options.keyGenerator ?? (defaultKeyGenerator as (request: TRequest) => string);
    const headersVersion = options.headers ?? 'draft-7';
    const legacyHeaders = options.legacyHeaders ?? false;
    const passOnStoreError = options.passOnStoreError ?? false;
    const skip = options.skip;

    const store = options.store ?? new MemoryStore();

    // Compute window seconds for the `w=` policy header
    const windowSeconds =
        'windowMs' in algo.config
            ? Math.ceil(Number(algo.config.windowMs) / 1000)
            : Math.ceil(
                  (typeof limitOption === 'number' ? limitOption : 60) /
                      (Number(algo.config.refillRate) / Number(algo.config.refillMs)) /
                      1000
              );

    const staticPolicyHeader =
        typeof limitOption !== 'function' && headersVersion === 'draft-7' ? String(limitOption) + ';w=' + String(windowSeconds) : undefined;

    function makeBypassResult(limit: number, now: number): RateLimitResult {
        const resetTimeMs = now + ('windowMs' in algo.config ? Number(algo.config.windowMs) : algo.ttlMs(limit));
        return {
            limited: false,
            limit,
            remaining: limit,
            resetTime: new Date(resetTimeMs),
            headers: generateHeaders(
                headersVersion,
                limit,
                limit,
                resetTimeMs,
                now,
                windowSeconds,
                legacyHeaders,
                false,
                0,
                staticPolicyHeader
            )
        };
    }

    function buildResult(consumeResult: ConsumeResult, limit: number, now: number): RateLimitResult {
        const resetTimeMs = consumeResult.resetTime.getTime();
        const retryAfterSeconds = consumeResult.limited ? Math.max(0, Math.ceil(consumeResult.retryAfterMs / 1000)) : 0;

        const headers = generateHeaders(
            headersVersion,
            limit,
            consumeResult.remaining,
            resetTimeMs,
            now,
            windowSeconds,
            legacyHeaders,
            consumeResult.limited,
            retryAfterSeconds,
            staticPolicyHeader
        );

        return {
            limited: consumeResult.limited,
            limit,
            remaining: consumeResult.remaining,
            resetTime: consumeResult.resetTime,
            headers
        };
    }

    // Not async on purpose — when the store is synchronous (e.g. MemoryStore),
    // this avoids wrapping the result in a Promise and the associated microtask overhead.
    function runConsume(key: string, limit: number, now: number, cost: number): RateLimitResult | Promise<RateLimitResult> {
        try {
            const consumeResult = store.consume(key, algo, limit, cost);
            if (isPromise(consumeResult)) {
                return consumeResult.then(
                    r => buildResult(r, limit, now),
                    () => {
                        if (passOnStoreError) return makeBypassResult(limit, now);
                        throw new Error('Rate limit store error');
                    }
                );
            }
            return buildResult(consumeResult, limit, now);
        } catch {
            if (passOnStoreError) return makeBypassResult(limit, now);
            throw new Error('Rate limit store error');
        }
    }

    // Async fallback for when skip/limit/key/cost are async
    async function asyncPath(request: TRequest): Promise<RateLimitResult> {
        const now = Date.now();

        if (skip) {
            const shouldSkip = await skip(request);
            if (shouldSkip) {
                const limit = typeof limitOption === 'function' ? await limitOption(request) : limitOption;
                return makeBypassResult(limit, now);
            }
        }

        const limit = typeof limitOption === 'function' ? await limitOption(request) : limitOption;
        const cost = typeof costOption === 'function' ? await costOption(request) : costOption;
        const key = await keyGenerator(request);
        return runConsume(key, limit, now, cost);
    }

    // Not async on purpose — when all inputs (key, limit, cost, store) are synchronous,
    // this returns a plain RateLimitResult with no Promise/microtask overhead.
    return (request: TRequest): RateLimitResult | Promise<RateLimitResult> => {
        // Fast path: no skip, static limit, static cost, sync keyGenerator, sync store
        if (skip) {
            return asyncPath(request);
        }

        // Resolve limit
        if (typeof limitOption === 'function') {
            return asyncPath(request);
        }

        // Resolve cost
        if (typeof costOption === 'function') {
            return asyncPath(request);
        }

        const now = Date.now();
        const limit = limitOption;
        const cost = costOption;

        // Resolve key
        const key = keyGenerator(request);
        if (isPromise(key)) {
            return key.then(k => runConsume(k, limit, now, cost));
        }

        // Consume and build result — fully synchronous when store is sync
        return runConsume(key, limit, now, cost);
    };
}

// ── buildResponse helper (used by middleware adapters) ────────────────────────

/**
 * Build a complete HTTP `Response` for a rate-limited request.
 *
 * Middleware adapters call this when {@link RateLimitResult.limited} is `true`.
 * If a custom {@link RateLimitOptions.handler | handler} is provided it takes
 * full control; otherwise a response is constructed from `message` and
 * `statusCode`.
 *
 * @param request - The original incoming request.
 * @param result - The rate limit evaluation result.
 * @param options - Response-building options (handler, message, statusCode).
 * @returns A `Response` ready to send back to the client.
 */
export async function buildRateLimitResponse<TRequest = Request>(
    request: TRequest,
    result: RateLimitResult,
    options: {
        handler?: (request: TRequest, result: RateLimitResult) => Response | Promise<Response>;
        message?: string | Record<string, unknown> | ((request: TRequest, result: RateLimitResult) => string | Record<string, unknown>);
        statusCode?: number;
    }
): Promise<Response> {
    if (options.handler) {
        return options.handler(request, result);
    }

    const statusCode = options.statusCode ?? 429;
    const message = options.message ?? 'Too Many Requests';

    let body: string;
    let contentType: string;

    if (typeof message === 'function') {
        const resolved = message(request, result);
        if (typeof resolved === 'string') {
            body = resolved;
            contentType = 'text/plain';
        } else {
            body = JSON.stringify(resolved);
            contentType = 'application/json';
        }
    } else if (typeof message === 'string') {
        body = message;
        contentType = 'text/plain';
    } else {
        body = JSON.stringify(message);
        contentType = 'application/json';
    }

    const responseHeaders = new Headers({ 'Content-Type': contentType });
    for (const [key, value] of Object.entries(result.headers)) {
        responseHeaders.set(key, value);
    }

    return new Response(body, { status: statusCode, headers: responseHeaders });
}
