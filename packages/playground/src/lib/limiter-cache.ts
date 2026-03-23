import { rateLimit, MemoryStore } from 'universal-rate-limit';
import type { AlgorithmConfig } from 'universal-rate-limit';
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
        a.legacyHeaders === b.legacyHeaders &&
        (a.refillRate ?? 10) === (b.refillRate ?? 10)
    );
}

function evictOldest(cache: Map<string, CachedEntry>): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of cache) {
        if (entry.lastAccessed < oldestTime) {
            oldestTime = entry.lastAccessed;
            oldestKey = key;
        }
    }
    if (oldestKey !== undefined) {
        cache.get(oldestKey)?.store.shutdown();
        cache.delete(oldestKey);
    }
}

export interface GetLimiterResult {
    limiter: (request: Request) => ReturnType<ReturnType<typeof rateLimit>>;
    configChanged: boolean;
}

/** Map a PlaygroundConfig algorithm name to an AlgorithmConfig object. */
function buildAlgorithmConfig(config: PlaygroundConfig): AlgorithmConfig {
    switch (config.algorithm) {
        case 'token-bucket': {
            return { type: 'token-bucket', refillRate: config.refillRate ?? 10 };
        }
        case 'fixed-window': {
            return { type: 'fixed-window', windowMs: config.windowMs };
        }
        case 'sliding-window': {
            return { type: 'sliding-window', windowMs: config.windowMs };
        }
    }
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

    const store = new MemoryStore();
    const algoConfig = buildAlgorithmConfig(config);
    const limiter = rateLimit({
        limit: config.limit,
        algorithm: algoConfig,
        store,
        headers: config.headers,
        legacyHeaders: config.legacyHeaders,
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

    // Access the opaque entries map inside MemoryStore (playground-only, fragile)
    const store = entry.store as unknown as {
        entries: Map<string, { state: unknown; expiresAt: number }> | undefined;
    };

    const storeEntry = store.entries?.get(ip);
    if (!storeEntry || storeEntry.expiresAt <= Date.now()) {
        return { currentWindowHits: 0, previousWindowHits: 0 };
    }

    const algorithm = entry.config.algorithm;
    const state = storeEntry.state as Record<string, number>;

    if (algorithm === 'fixed-window') {
        return { currentWindowHits: state.hits, previousWindowHits: 0 };
    }
    if (algorithm === 'sliding-window') {
        return { currentWindowHits: state.currentHits, previousWindowHits: state.previousHits };
    }
    // Token bucket doesn't have window hits, return tokens info
    return { currentWindowHits: 0, previousWindowHits: 0 };
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
            algorithm: { type: 'fixed-window', windowMs: API_WINDOW_MS },
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
