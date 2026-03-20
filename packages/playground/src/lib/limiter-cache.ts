import { rateLimit, MemoryStore } from 'universal-rate-limit';
import type { PlaygroundConfig } from './types';

/** Maximum number of cached limiter instances (one per IP). */
const MAX_CACHE_SIZE = 30;

/** Entries unused for this long are eligible for cleanup (5 minutes). */
const ENTRY_TTL_MS = 300_000;

/** How often to run the TTL sweep (1 minute). */
const CLEANUP_INTERVAL_MS = 60_000;

/** Common proxy/CDN headers that carry the client's real IP address. */
const IP_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'fly-client-ip'];

/** Extract the client IP from the request. Falls back to '127.0.0.1'. */
export function getClientIp(request: Request): string {
    for (const header of IP_HEADERS) {
        const value = request.headers.get(header);
        if (value) {
            return value.split(',')[0].trim();
        }
    }
    return '127.0.0.1';
}

export type LimiterConfig = PlaygroundConfig;

interface CachedEntry {
    config: LimiterConfig;
    limiter: (request: Request) => ReturnType<ReturnType<typeof rateLimit>>;
    store: MemoryStore;
    lastAccessed: number;
}

function getCache(): Map<string, CachedEntry> {
    const g = globalThis as unknown as {
        __rateLimitCache?: Map<string, CachedEntry>;
        __rateLimitCleanupTimer?: ReturnType<typeof setInterval>;
    };

    if (!g.__rateLimitCache) {
        const cache = new Map<string, CachedEntry>();
        g.__rateLimitCache = cache;

        // Background sweep for stale entries
        g.__rateLimitCleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [key, cached] of cache) {
                if (now - cached.lastAccessed > ENTRY_TTL_MS) {
                    cached.store.shutdown();
                    cache.delete(key);
                }
            }
        }, CLEANUP_INTERVAL_MS);

        if (typeof g.__rateLimitCleanupTimer === 'object' && 'unref' in g.__rateLimitCleanupTimer) {
            g.__rateLimitCleanupTimer.unref();
        }
    }

    return g.__rateLimitCache;
}

function configsMatch(a: LimiterConfig, b: LimiterConfig): boolean {
    return (
        a.limit === b.limit &&
        a.windowMs === b.windowMs &&
        a.algorithm === b.algorithm &&
        a.headers === b.headers &&
        a.legacyHeaders === b.legacyHeaders
    );
}

function evictOldest(cache: Map<string, CachedEntry>): void {
    const oldest = cache.keys().next();
    if (!oldest.done) {
        const entry = cache.get(oldest.value);
        if (entry) {
            entry.store.shutdown();
        }
        cache.delete(oldest.value);
    }
}

export interface GetLimiterResult {
    limiter: (request: Request) => ReturnType<ReturnType<typeof rateLimit>>;
    configChanged: boolean;
}

/**
 * Get or create the limiter for the given IP.
 * Each IP gets exactly one active config. If the config differs from
 * the stored one, the old limiter is replaced and `configChanged` is true.
 */
export function getLimiter(ip: string, config: LimiterConfig): GetLimiterResult {
    const cache = getCache();
    const existing = cache.get(ip);

    if (existing && configsMatch(existing.config, config)) {
        existing.lastAccessed = Date.now();
        return { limiter: existing.limiter, configChanged: false };
    }

    // Config changed or new IP — tear down old entry if present
    const configChanged = existing !== undefined;
    if (existing) {
        existing.store.shutdown();
        cache.delete(ip);
    }

    while (cache.size >= MAX_CACHE_SIZE) {
        evictOldest(cache);
    }

    const store = new MemoryStore(config.windowMs);
    const limiter = rateLimit({
        ...config,
        store,
        keyGenerator: () => ip
    });

    cache.set(ip, { config, limiter, store, lastAccessed: Date.now() });
    return { limiter, configChanged };
}

export interface StoreHits {
    currentWindowHits: number;
    previousWindowHits: number;
}

/**
 * Peek into the MemoryStore to get raw hit counts for the sliding window interpolation.
 * Uses type assertion to access private fields — this is playground-only code.
 */
export function getStoreHits(ip: string): StoreHits {
    const entry = getCache().get(ip);
    if (!entry) {
        return { currentWindowHits: 0, previousWindowHits: 0 };
    }

    interface WindowEntry {
        hits: number;
        resetTime: number;
    }

    const store = entry.store as unknown as {
        current: Map<string, WindowEntry>;
        previous: Map<string, WindowEntry>;
        windowMs: number;
    };

    const now = Date.now();
    const currentEntry = store.current.get(ip);
    const previousEntry = store.previous.get(ip);

    const currentWindowHits = currentEntry && currentEntry.resetTime > now ? currentEntry.hits : 0;
    const previousWindowHits = previousEntry && previousEntry.resetTime > now - store.windowMs ? previousEntry.hits : 0;

    return { currentWindowHits, previousWindowHits };
}

export function resetByIp(ip: string): void {
    const cache = getCache();
    const entry = cache.get(ip);
    if (entry) {
        entry.store.resetAll();
        entry.store.shutdown();
        cache.delete(ip);
    }
}

// ── Per-IP rate limiter for the playground API itself ────────────────────────

const API_RATE_LIMIT = 120; // requests per window
const API_WINDOW_MS = 60_000; // 1 minute

let apiLimiter: ReturnType<typeof rateLimit> | undefined;

function getApiLimiter(): ReturnType<typeof rateLimit> {
    if (!apiLimiter) {
        apiLimiter = rateLimit({
            limit: API_RATE_LIMIT,
            windowMs: API_WINDOW_MS,
            algorithm: 'fixed-window',
            headers: 'draft-7'
        });
    }
    return apiLimiter;
}

/**
 * Check if the incoming request is allowed by the playground's own rate limit.
 * Returns a 429 Response if blocked, or null if allowed.
 */
export async function checkApiRateLimit(request: Request): Promise<Response | null> {
    const limiter = getApiLimiter();
    const result = await limiter(request);

    if (result.limited) {
        const headers = new Headers();
        for (const [key, value] of Object.entries(result.headers)) {
            headers.set(key, value);
        }
        return Response.json({ error: 'Playground rate limit exceeded. Try again shortly.' }, { status: 429, headers });
    }

    return null;
}
