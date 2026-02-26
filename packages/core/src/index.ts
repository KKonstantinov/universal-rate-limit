// ── Types ────────────────────────────────────────────────────────────────────

export interface IncrementResult {
    totalHits: number;
    resetTime: Date;
}

export interface Store {
    increment(key: string): Promise<IncrementResult>;
    decrement(key: string): Promise<void>;
    resetKey(key: string): Promise<void>;
    resetAll(): Promise<void>;
}

export type Algorithm = 'fixed-window' | 'sliding-window';

export type HeadersVersion = 'draft-6' | 'draft-7';

export interface RateLimitOptions {
    windowMs?: number;
    limit?: number | ((request: Request) => number | Promise<number>);
    keyGenerator?: (request: Request) => string | Promise<string>;
    store?: Store;
    algorithm?: Algorithm;
    headers?: HeadersVersion;
    handler?: (request: Request, result: RateLimitResult) => Response | Promise<Response>;
    message?: string | Record<string, unknown> | ((request: Request, result: RateLimitResult) => string | Record<string, unknown>);
    statusCode?: number;
    skip?: (request: Request) => boolean | Promise<boolean>;
    passOnStoreError?: boolean;
}

export interface RateLimitResult {
    limited: boolean;
    limit: number;
    remaining: number;
    resetTime: Date;
    headers: Record<string, string>;
}

// ── Default key generator ────────────────────────────────────────────────────

const IP_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'fly-client-ip'];

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

function generateHeaders(
    version: HeadersVersion,
    limit: number,
    remaining: number,
    resetTime: Date,
    windowMs: number
): Record<string, string> {
    const resetSeconds = Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000));

    if (version === 'draft-6') {
        return {
            'RateLimit-Limit': String(limit),
            'RateLimit-Remaining': String(Math.max(0, remaining)),
            'RateLimit-Reset': String(resetSeconds)
        };
    }

    // draft-7: combined headers using Structured Fields
    const windowSeconds = Math.ceil(windowMs / 1000);
    return {
        RateLimit: 'limit=' + String(limit) + ', remaining=' + String(Math.max(0, remaining)) + ', reset=' + String(resetSeconds),
        'RateLimit-Policy': String(limit) + ';w=' + String(windowSeconds)
    };
}

// ── MemoryStore ──────────────────────────────────────────────────────────────

interface WindowEntry {
    hits: number;
    resetTime: number;
}

export class MemoryStore implements Store {
    private readonly windowMs: number;
    private readonly algorithm: Algorithm;
    private current = new Map<string, WindowEntry>();
    private previous = new Map<string, WindowEntry>();
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(windowMs: number, algorithm: Algorithm) {
        this.windowMs = windowMs;
        this.algorithm = algorithm;

        this.timer = setInterval(() => {
            this.cleanup();
        }, windowMs);

        // Allow the timer to not keep the process alive
        if (typeof this.timer === 'object' && 'unref' in this.timer) {
            this.timer.unref();
        }
    }

    increment(key: string): Promise<IncrementResult> {
        const now = Date.now();
        const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
        const windowEnd = windowStart + this.windowMs;

        let entry = this.current.get(key);
        if (!entry || entry.resetTime <= now) {
            // Window expired — rotate current to previous
            if (entry) {
                this.previous.set(key, entry);
            }
            entry = { hits: 0, resetTime: windowEnd };
            this.current.set(key, entry);
        }

        entry.hits++;

        if (this.algorithm === 'sliding-window') {
            const prev = this.previous.get(key);
            const prevHits = prev && prev.resetTime > now - this.windowMs ? prev.hits : 0;
            const elapsed = now - windowStart;
            const weight = 1 - elapsed / this.windowMs;
            const totalHits = Math.ceil(prevHits * weight + entry.hits);
            return Promise.resolve({ totalHits, resetTime: new Date(windowEnd) });
        }

        return Promise.resolve({ totalHits: entry.hits, resetTime: new Date(entry.resetTime) });
    }

    decrement(key: string): Promise<void> {
        const entry = this.current.get(key);
        if (entry && entry.hits > 0) {
            entry.hits--;
        }
        return Promise.resolve();
    }

    resetKey(key: string): Promise<void> {
        this.current.delete(key);
        this.previous.delete(key);
        return Promise.resolve();
    }

    resetAll(): Promise<void> {
        this.current.clear();
        this.previous.clear();
        return Promise.resolve();
    }

    shutdown(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

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

// ── rateLimit factory ────────────────────────────────────────────────────────

export function rateLimit(options: RateLimitOptions = {}): (request: Request) => Promise<RateLimitResult> {
    const windowMs = options.windowMs ?? 60_000;
    const limitOption = options.limit ?? 60;
    const keyGenerator = options.keyGenerator ?? defaultKeyGenerator;
    const algorithm = options.algorithm ?? 'fixed-window';
    const headersVersion = options.headers ?? 'draft-7';
    const passOnStoreError = options.passOnStoreError ?? false;
    const skip = options.skip;
    const handler = options.handler;

    const store = options.store ?? new MemoryStore(windowMs, algorithm);

    return async (request: Request): Promise<RateLimitResult> => {
        // Check skip
        if (skip) {
            const shouldSkip = await skip(request);
            if (shouldSkip) {
                const limit = typeof limitOption === 'function' ? await limitOption(request) : limitOption;
                return {
                    limited: false,
                    limit,
                    remaining: limit,
                    resetTime: new Date(Date.now() + windowMs),
                    headers: generateHeaders(headersVersion, limit, limit, new Date(Date.now() + windowMs), windowMs)
                };
            }
        }

        // Resolve limit
        const limit = typeof limitOption === 'function' ? await limitOption(request) : limitOption;

        let totalHits: number;
        let resetTime: Date;

        try {
            const result = await store.increment(await keyGenerator(request));
            totalHits = result.totalHits;
            resetTime = result.resetTime;
        } catch {
            if (passOnStoreError) {
                return {
                    limited: false,
                    limit,
                    remaining: limit,
                    resetTime: new Date(Date.now() + windowMs),
                    headers: generateHeaders(headersVersion, limit, limit, new Date(Date.now() + windowMs), windowMs)
                };
            }
            throw new Error('Rate limit store error');
        }

        const remaining = limit - totalHits;
        const limited = remaining < 0;
        const headers = generateHeaders(headersVersion, limit, remaining, resetTime, windowMs);

        const result: RateLimitResult = { limited, limit, remaining: Math.max(0, remaining), resetTime, headers };

        // If limited and a custom handler is provided, attach the response
        if (limited && handler) {
            result.headers = headers;
        }

        return result;
    };
}

// ── buildResponse helper (used by middleware adapters) ────────────────────────

export async function buildRateLimitResponse(
    request: Request,
    result: RateLimitResult,
    options: {
        handler?: (request: Request, result: RateLimitResult) => Response | Promise<Response>;
        message?: string | Record<string, unknown> | ((request: Request, result: RateLimitResult) => string | Record<string, unknown>);
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
