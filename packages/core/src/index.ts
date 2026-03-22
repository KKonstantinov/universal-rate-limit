// ── Types ────────────────────────────────────────────────────────────────────

/** A value that may or may not be wrapped in a Promise. */
export type MaybePromise<T> = T | Promise<T>;

/** The result of a store increment operation. */
export interface IncrementResult {
    /** Raw hit count in the current window (before any algorithm weighting). */
    currentHits: number;
    /**
     * Raw hit count in the previous window (before any algorithm weighting).
     * Stores that do not track previous-window counts should return `0`.
     */
    previousHits: number;
    /** The time at which the current rate limit window resets. */
    resetTime: Date;
}

/**
 * Backend store interface for persisting rate limit hit counts.
 *
 * Implementations must be safe for concurrent access. The built-in
 * {@link MemoryStore} is suitable for single-process deployments;
 * use a Redis-backed store for distributed environments.
 */
export interface Store {
    /** Key prefix prepended to every rate limit key in the store. */
    prefix?: string;
    /** Fetch a client's hit counts and reset time without incrementing. */
    get?(key: string): MaybePromise<IncrementResult | undefined>;
    /** Increment the hit count for `key` and return the updated totals. */
    increment(key: string): MaybePromise<IncrementResult>;
    /** Decrement the hit count for `key` (e.g. to undo a counted request). */
    decrement(key: string): MaybePromise<void>;
    /** Remove all rate limit data for a single `key`. */
    resetKey(key: string): MaybePromise<void>;
    /** Remove all rate limit data for every key in the store. */
    resetAll(): MaybePromise<void>;
    /** Release any resources held by the store (timers, connections, etc.). */
    shutdown?(): MaybePromise<void>;
}

/**
 * The windowing algorithm used to count requests.
 *
 * - `'fixed-window'` — resets the counter at fixed intervals.
 * - `'sliding-window'` — smooths burst edges by weighting the previous
 *   window's count into the current window.
 */
export type Algorithm = 'fixed-window' | 'sliding-window';

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
    /** Duration of the rate limit window in milliseconds. @default 60_000 */
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
     * The backing store used to track hit counts. When omitted, an in-memory
     * {@link MemoryStore} is created automatically.
     */
    store?: Store;
    /** The windowing algorithm. @default 'sliding-window' */
    algorithm?: Algorithm;
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
 * @param version - The header draft format to use.
 * @param limit - Maximum allowed requests in the window.
 * @param remaining - Remaining requests before the limit is hit.
 * @param resetTimeMs - Unix-ms timestamp when the window resets.
 * @param nowMs - Current Unix-ms timestamp (avoids redundant Date.now() calls).
 * @param windowSeconds - Window duration in seconds (pre-computed by the factory).
 * @param legacyHeaders - Whether to include X-RateLimit-* headers.
 * @param limited - Whether the request was rate-limited. When `true`, a
 *   {@link https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3 | RFC 9110 §10.2.3}
 *   `Retry-After` header is included using the delay-seconds format.
 * @param policyHeader - Pre-computed RateLimit-Policy value (static-limit optimisation).
 * @returns A plain object of header name/value pairs.
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

// ── Algorithm strategies ─────────────────────────────────────────────────────

/** Context passed to {@link AlgorithmStrategy} methods. */
export interface AlgorithmContext {
    /** Raw hit count in the current window. */
    currentHits: number;
    /** Raw hit count in the previous window (0 when the store doesn't track it). */
    previousHits: number;
    /** Unix-ms timestamp when the current rate limit window resets. */
    resetTimeMs: number;
    /** Current Unix-ms timestamp. */
    nowMs: number;
    /** Window duration in milliseconds. */
    windowMs: number;
    /** Maximum allowed requests per window. */
    limit: number;
}

/**
 * Per-algorithm strategy that encapsulates how hits are counted and when
 * a rate-limited client may retry. Implementations are stateless — all
 * inputs arrive via the {@link AlgorithmContext}.
 */
export interface AlgorithmStrategy {
    /** Compute the effective total hits after applying any windowing logic. */
    computeTotalHits(context: AlgorithmContext): number;
    /** Compute the Retry-After delay (in ms) when a request is rate-limited. */
    computeRetryAfterMs(context: AlgorithmContext): number;
}

/**
 * Fixed-window strategy.
 *
 * - Total hits = current window hits (previous window is ignored).
 * - Retry-After = time until the window resets.
 */
export const fixedWindowStrategy: AlgorithmStrategy = {
    computeTotalHits({ currentHits }) {
        return currentHits;
    },
    computeRetryAfterMs({ resetTimeMs, nowMs }) {
        return Math.max(0, resetTimeMs - nowMs);
    }
};

/**
 * Sliding-window strategy.
 *
 * - Total hits = `ceil(previousHits * weight + currentHits)` where
 *   `weight = 1 - elapsed / windowMs` decays linearly over the window.
 * - Retry-After computes the earliest time `t` at which
 *   `ceil(prevHits * weight(t) + currHits + 1) <= limit`, accounting for the
 *   retry request itself incrementing the counter.
 */
export const slidingWindowStrategy: AlgorithmStrategy = {
    computeTotalHits({ currentHits, previousHits, resetTimeMs, nowMs, windowMs }) {
        if (previousHits === 0) return currentHits;
        const windowStart = resetTimeMs - windowMs;
        const elapsed = nowMs - windowStart;
        const weight = Math.max(0, 1 - elapsed / windowMs);
        return Math.ceil(previousHits * weight + currentHits);
    },

    computeRetryAfterMs({ resetTimeMs, nowMs, windowMs, limit, currentHits, previousHits }) {
        // The retry request will add +1 hit, so we need room for currHits + 1
        const threshold = limit - 1 - currentHits; // prevHits * weight must be <= this

        // Case 1: Can we recover within the current window via previous hits decaying?
        if (previousHits > 0 && threshold >= 0) {
            const targetWeight = threshold / previousHits;
            if (targetWeight >= 1) return 0; // Already recovered
            const targetElapsed = windowMs * (1 - targetWeight);
            const windowStart = resetTimeMs - windowMs;
            const retryAtMs = windowStart + targetElapsed;
            if (retryAtMs > nowMs) return retryAtMs - nowMs;
            return 0;
        }

        // Case 2: Need to wait past resetTime for currentHits to become previous and decay.
        // After resetTime: old prevHits are fully decayed (weight = 0), old currentHits
        // become the new previous window. The retry adds 1 to new currentHits.
        // Need: ceil(currentHits * newWeight + 1) <= limit
        //       currentHits * newWeight <= limit - 1
        if (currentHits === 0) return 0;

        const targetNewWeight = (limit - 1) / currentHits;
        if (targetNewWeight >= 1) {
            // Recover immediately at resetTime (hits < limit right after rotation)
            return Math.max(0, resetTimeMs - nowMs);
        }

        const targetElapsedNew = windowMs * (1 - targetNewWeight);
        return Math.max(0, resetTimeMs + targetElapsedNew - nowMs);
    }
};

const algorithmStrategies: Record<Algorithm, AlgorithmStrategy> = {
    'fixed-window': fixedWindowStrategy,
    'sliding-window': slidingWindowStrategy
};

// ── MemoryStore ──────────────────────────────────────────────────────────────

/** Internal bookkeeping for a single key inside a time window. */
interface WindowEntry {
    /** Number of requests recorded in this window. */
    hits: number;
    /** Unix-ms timestamp at which this window expires. */
    resetTime: number;
    /** Cached Date for resetTime — avoids allocating a new Date per request. */
    resetDate: Date;
}

/**
 * In-memory {@link Store} implementation backed by two rotating `Map`s.
 *
 * Returns raw per-window hit counts; the algorithm strategy in
 * {@link rateLimit} is responsible for computing weighted totals.
 * A background interval rotates expired entries automatically.
 * Call {@link shutdown} to clear the interval when the store is no longer needed.
 *
 * **Note:** This store is per-process — it is not shared across cluster
 * workers or server instances. Use a Redis-backed store for distributed
 * deployments.
 */
export class MemoryStore implements Store {
    readonly prefix?: string;
    private readonly windowMs: number;
    private readonly current = new Map<string, WindowEntry>();
    private readonly previous = new Map<string, WindowEntry>();
    private timer: ReturnType<typeof setInterval> | undefined;

    /** @param windowMs - Duration of the rate limit window in milliseconds. */
    constructor(windowMs: number, prefix?: string) {
        this.windowMs = windowMs;
        this.prefix = prefix;

        this.timer = setInterval(() => {
            this.cleanup();
        }, windowMs);

        // Allow the timer to not keep the process alive
        if (typeof this.timer === 'object' && 'unref' in this.timer) {
            this.timer.unref();
        }
    }

    /** @inheritdoc */
    get(key: string): IncrementResult | undefined {
        const now = Date.now();
        const entry = this.current.get(key);
        if (!entry || entry.resetTime <= now) return undefined;

        const prev = this.previous.get(key);
        const previousHits = prev && prev.resetTime > now - this.windowMs ? prev.hits : 0;

        return { currentHits: entry.hits, previousHits, resetTime: entry.resetDate };
    }

    /** @inheritdoc */
    increment(key: string): IncrementResult {
        const now = Date.now();
        const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
        const windowEnd = windowStart + this.windowMs;

        let entry = this.current.get(key);
        if (!entry || entry.resetTime <= now) {
            // Window expired — rotate current to previous
            if (entry) {
                this.previous.set(key, entry);
            }
            entry = { hits: 0, resetTime: windowEnd, resetDate: new Date(windowEnd) };
            this.current.set(key, entry);
        }

        entry.hits++;

        const prev = this.previous.get(key);
        const previousHits = prev && prev.resetTime > now - this.windowMs ? prev.hits : 0;

        return { currentHits: entry.hits, previousHits, resetTime: entry.resetDate };
    }

    /** @inheritdoc */
    decrement(key: string): void {
        const entry = this.current.get(key);
        if (entry && entry.hits > 0) {
            entry.hits--;
        }
    }

    /** @inheritdoc */
    resetKey(key: string): void {
        this.current.delete(key);
        this.previous.delete(key);
    }

    /** @inheritdoc */
    resetAll(): void {
        this.current.clear();
        this.previous.clear();
    }

    /** @inheritdoc */
    shutdown(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    /** Rotate expired entries from `current` into `previous` and evict stale `previous` entries. */
    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.current) {
            if (entry.resetTime <= now) {
                this.previous.set(key, entry);
                this.current.delete(key);
            }
        }
        for (const [key, entry] of this.previous) {
            if (entry.resetTime <= now - this.windowMs) {
                this.previous.delete(key);
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
    const windowMs = options.windowMs ?? 60_000;
    const limitOption = options.limit ?? 60;

    if (windowMs <= 0) {
        throw new RangeError(`windowMs must be a positive number, got ${String(windowMs)}`);
    }
    if (typeof limitOption === 'number' && limitOption < 0) {
        throw new RangeError(`limit must be a non-negative number, got ${String(limitOption)}`);
    }

    const keyGenerator = options.keyGenerator ?? (defaultKeyGenerator as (request: TRequest) => string);
    const algorithm = options.algorithm ?? 'sliding-window';
    const headersVersion = options.headers ?? 'draft-7';
    const legacyHeaders = options.legacyHeaders ?? false;
    const passOnStoreError = options.passOnStoreError ?? false;
    const skip = options.skip;

    const store = options.store ?? new MemoryStore(windowMs);

    // Pre-compute constants that are invariant across requests
    const windowSeconds = Math.ceil(windowMs / 1000);
    const staticPolicyHeader =
        typeof limitOption !== 'function' && headersVersion === 'draft-7' ? String(limitOption) + ';w=' + String(windowSeconds) : undefined;

    const strategy = algorithmStrategies[algorithm];

    function makeBypassResult(limit: number, now: number): RateLimitResult {
        const resetTimeMs = now + windowMs;
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

    function buildResult(incrementResult: IncrementResult, limit: number, now: number): RateLimitResult {
        const resetTimeMs = incrementResult.resetTime.getTime();
        const context: AlgorithmContext = {
            currentHits: incrementResult.currentHits,
            previousHits: incrementResult.previousHits,
            resetTimeMs,
            nowMs: now,
            windowMs,
            limit
        };

        const totalHits = strategy.computeTotalHits(context);
        const remaining = limit - totalHits;
        const limited = remaining < 0;

        let retryAfterSeconds = 0;
        if (limited) {
            retryAfterSeconds = Math.max(0, Math.ceil(strategy.computeRetryAfterMs(context) / 1000));
        }

        const headers = generateHeaders(
            headersVersion,
            limit,
            remaining,
            resetTimeMs,
            now,
            windowSeconds,
            legacyHeaders,
            limited,
            retryAfterSeconds,
            staticPolicyHeader
        );
        return { limited, limit, remaining: Math.max(0, remaining), resetTime: incrementResult.resetTime, headers };
    }

    // Not async on purpose — when the store is synchronous (e.g. MemoryStore),
    // this avoids wrapping the result in a Promise and the associated microtask overhead.
    function runIncrement(key: string, limit: number, now: number): RateLimitResult | Promise<RateLimitResult> {
        try {
            const incrementResult = store.increment(key);
            if (isPromise(incrementResult)) {
                return incrementResult.then(
                    r => buildResult(r, limit, now),
                    () => {
                        if (passOnStoreError) return makeBypassResult(limit, now);
                        throw new Error('Rate limit store error');
                    }
                );
            }
            return buildResult(incrementResult, limit, now);
        } catch {
            if (passOnStoreError) return makeBypassResult(limit, now);
            throw new Error('Rate limit store error');
        }
    }

    // Async fallback for when skip/limit/key are async
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
        const key = await keyGenerator(request);
        return runIncrement(key, limit, now);
    }

    // Not async on purpose — when all inputs (key, limit, store) are synchronous,
    // this returns a plain RateLimitResult with no Promise/microtask overhead.
    return (request: TRequest): RateLimitResult | Promise<RateLimitResult> => {
        // Fast path: no skip, static limit, sync keyGenerator, sync store
        if (skip) {
            return asyncPath(request);
        }

        // Resolve limit
        if (typeof limitOption === 'function') {
            return asyncPath(request);
        }

        const now = Date.now();
        const limit = limitOption;

        // Resolve key
        const key = keyGenerator(request);
        if (isPromise(key)) {
            return key.then(k => runIncrement(k, limit, now));
        }

        // Increment and build result — fully synchronous when store is sync
        return runIncrement(key, limit, now);
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
