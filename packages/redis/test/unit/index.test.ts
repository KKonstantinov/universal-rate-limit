import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { RedisStore } from '../../src/index.js';
import type { SendCommandFn, RedisReply } from '../../src/index.js';
import { rateLimit, fixedWindow, slidingWindow, tokenBucket } from 'universal-rate-limit';
import type { Algorithm } from 'universal-rate-limit';
import {
    FIXED_WINDOW_CONSUME,
    FIXED_WINDOW_PEEK,
    SLIDING_WINDOW_CONSUME,
    SLIDING_WINDOW_PEEK,
    TOKEN_BUCKET_CONSUME,
    TOKEN_BUCKET_PEEK
} from '../../src/scripts.js';

// ── Mock Redis ──────────────────────────────────────────────────────────────

interface MockEntry {
    value: string;
    fields?: Map<string, string>;
    expiresAt: number;
}

function sha1(script: string): string {
    return createHash('sha1').update(script).digest('hex');
}

/**
 * Creates a mock sendCommand that simulates Redis in-memory.
 * Supports: SCRIPT LOAD, EVALSHA, EVAL, DEL, SCAN, and Lua script execution
 * for all three algorithm types (fixed-window, sliding-window, token-bucket).
 */
function createMockRedis(): {
    sendCommand: SendCommandFn;
    store: Map<string, MockEntry>;
    scripts: Map<string, string>;
} {
    const store = new Map<string, MockEntry>();
    const scripts = new Map<string, string>();

    function getEntry(key: string): MockEntry | undefined {
        const entry = store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
            store.delete(key);
            return undefined;
        }
        return entry;
    }

    function handleScript(args: string[]): RedisReply {
        const subcommand = args[1]?.toUpperCase();
        if (subcommand !== 'LOAD') {
            throw new TypeError(`Mock Redis: unsupported SCRIPT subcommand "${subcommand}"`);
        }
        const script = args[2];
        if (typeof script !== 'string') {
            throw new TypeError('Mock Redis: SCRIPT LOAD requires a script argument');
        }
        const hash = sha1(script);
        scripts.set(hash, script);
        return hash;
    }

    function handleEvalsha(args: string[]): RedisReply {
        const evalSha = args[1];
        const script = scripts.get(evalSha);
        if (!script) {
            throw new Error('NOSCRIPT No matching script. Please use EVAL.');
        }

        const numKeys = Number(args[2]);
        const keys = args.slice(3, 3 + numKeys);
        const argv = args.slice(3 + numKeys);
        return executeLuaScript(script, keys, argv);
    }

    function handleEval(args: string[]): RedisReply {
        const script = args[1];
        const numKeys = Number(args[2]);
        const keys = args.slice(3, 3 + numKeys);
        const argv = args.slice(3 + numKeys);
        return executeLuaScript(script, keys, argv);
    }

    function handleDel(args: string[]): RedisReply {
        let deleted = 0;
        for (let i = 1; i < args.length; i++) {
            if (store.delete(args[i])) deleted++;
        }
        return deleted;
    }

    function handleScan(args: string[]): RedisReply {
        const pattern = args[3];
        if (!pattern.endsWith('*')) {
            throw new Error(`Mock Redis: SCAN only supports trailing-wildcard patterns, got "${pattern}"`);
        }
        const prefix = pattern.slice(0, -1);
        const matchingKeys: string[] = [];
        for (const key of store.keys()) {
            if (key.startsWith(prefix)) {
                const entry = getEntry(key);
                if (entry) matchingKeys.push(key);
            }
        }
        return ['0', matchingKeys];
    }

    const commandHandlers: Partial<Record<string, (args: string[]) => RedisReply>> = {
        SCRIPT: handleScript,
        EVALSHA: handleEvalsha,
        EVAL: handleEval,
        DEL: handleDel,
        SCAN: handleScan
    };

    const sendCommand: SendCommandFn = async (...args: string[]): Promise<RedisReply> => {
        const command = args[0].toUpperCase();
        const handler = commandHandlers[command];
        if (!handler) {
            throw new Error(`Mock Redis: unsupported command "${command}"`);
        }
        return handler(args);
    };

    // Script hash lookup for routing
    const knownScripts = new Map<string, string>();
    for (const [name, script] of [
        ['fixed-window-consume', FIXED_WINDOW_CONSUME],
        ['fixed-window-peek', FIXED_WINDOW_PEEK],
        ['sliding-window-consume', SLIDING_WINDOW_CONSUME],
        ['sliding-window-peek', SLIDING_WINDOW_PEEK],
        ['token-bucket-consume', TOKEN_BUCKET_CONSUME],
        ['token-bucket-peek', TOKEN_BUCKET_PEEK]
    ] as const) {
        knownScripts.set(sha1(script), name);
    }

    function executeLuaScript(script: string, keys: string[], argv: string[]): RedisReply {
        const scriptHash = sha1(script);
        const scriptName = knownScripts.get(scriptHash);

        switch (scriptName) {
            case 'fixed-window-consume': {
                return executeFixedWindowConsume(keys[0], argv);
            }
            case 'fixed-window-peek': {
                return executeFixedWindowPeek(keys[0], argv);
            }
            case 'sliding-window-consume': {
                return executeSlidingWindowConsume(keys[0], argv);
            }
            case 'sliding-window-peek': {
                return executeSlidingWindowPeek(keys[0], argv);
            }
            case 'token-bucket-consume': {
                return executeTokenBucketConsume(keys[0], argv);
            }
            case 'token-bucket-peek': {
                return executeTokenBucketPeek(keys[0], argv);
            }
            default: {
                throw new Error(`Mock Redis: unknown script (hash: ${scriptHash})`);
            }
        }
    }

    // ── Fixed Window Lua emulation ──

    function executeFixedWindowConsume(key: string, argv: string[]): RedisReply {
        const windowMs = Number(argv[0]);
        const limit = Number(argv[1]);
        const nowMs = Number(argv[2]);
        const cost = Number(argv[3]) || 1;

        const entry = getEntry(key);

        if (!entry) {
            // New key: start a fresh window
            store.set(key, { value: String(cost), expiresAt: nowMs + windowMs });
            const resetTime = nowMs + windowMs;
            const limited = cost > limit ? 1 : 0;
            const remaining = Math.max(0, limit - cost);
            const retryAfterMs = limited ? resetTime - nowMs : 0;
            return [limited, remaining, resetTime, retryAfterMs];
        }

        // Check if window expired
        const ttl = entry.expiresAt > 0 ? Math.max(0, entry.expiresAt - nowMs) : -1;
        if (ttl <= 0) {
            store.set(key, { value: String(cost), expiresAt: nowMs + windowMs });
            const resetTime = nowMs + windowMs;
            const limited = cost > limit ? 1 : 0;
            const remaining = Math.max(0, limit - cost);
            const retryAfterMs = limited ? resetTime - nowMs : 0;
            return [limited, remaining, resetTime, retryAfterMs];
        }

        // Increment by cost
        const hits = Number(entry.value) + cost;
        entry.value = String(hits);
        const resetTime = entry.expiresAt;
        const limited = hits > limit ? 1 : 0;
        const remaining = Math.max(0, limit - hits);
        const retryAfterMs = limited ? resetTime - nowMs : 0;
        return [limited, remaining, resetTime, retryAfterMs];
    }

    function executeFixedWindowPeek(key: string, argv: string[]): RedisReply {
        const entry = getEntry(key);
        if (!entry) return [-1]; // key not found
        const limit = Number(argv[0]);
        const nowMs = Number(argv[1]);
        const hits = Number(entry.value);
        const ttl = entry.expiresAt > 0 ? Math.max(0, entry.expiresAt - nowMs) : 0;
        const resetTime = nowMs + ttl;
        const limited = hits > limit ? 1 : 0;
        const remaining = Math.max(0, limit - hits);
        const retryAfterMs = limited ? Math.max(0, resetTime - nowMs) : 0;
        return [limited, remaining, resetTime, retryAfterMs];
    }

    // ── Sliding Window Lua emulation ──

    function executeSlidingWindowConsume(key: string, argv: string[]): RedisReply {
        const windowMs = Number(argv[0]);
        const limit = Number(argv[1]);
        const nowMs = Number(argv[2]);
        const cost = Number(argv[3]) || 1;

        const entry = getEntry(key);
        let currentHits: number;
        let previousHits: number;
        let windowStart: number;

        if (!entry || !entry.fields) {
            // First request
            currentHits = cost;
            previousHits = 0;
            windowStart = nowMs;
        } else {
            currentHits = Number(entry.fields.get('curr') ?? '0');
            previousHits = Number(entry.fields.get('prev') ?? '0');
            windowStart = Number(entry.fields.get('windowStart') ?? String(nowMs));

            if (nowMs >= windowStart + windowMs) {
                if (nowMs < windowStart + 2 * windowMs) {
                    // Single window rotation
                    previousHits = currentHits;
                    currentHits = cost;
                    windowStart = windowStart + windowMs;
                } else {
                    // Multi-window gap
                    previousHits = 0;
                    currentHits = cost;
                    windowStart = nowMs;
                }
            } else {
                currentHits += cost;
            }
        }

        // Compute weighted total
        const elapsed = nowMs - windowStart;
        const weight = Math.max(0, 1 - elapsed / windowMs);
        const totalHits = Math.ceil(previousHits * weight + currentHits);
        const limited = totalHits > limit ? 1 : 0;
        const remaining = Math.max(0, limit - totalHits);
        const resetTime = windowStart + windowMs;

        // Compute retryAfterMs (matches core sliding-window logic)
        let retryAfterMs = 0;
        if (limited) {
            const threshold = limit - 1 - currentHits;
            if (previousHits > 0 && threshold >= 0) {
                const targetWeight = threshold / previousHits;
                if (targetWeight >= 1) {
                    retryAfterMs = 0;
                } else {
                    const targetElapsed = windowMs * (1 - targetWeight);
                    retryAfterMs = Math.max(0, windowStart + targetElapsed - nowMs);
                }
            } else if (currentHits === 0) {
                retryAfterMs = 0;
            } else {
                const targetNewWeight = (limit - 1) / currentHits;
                if (targetNewWeight >= 1) {
                    retryAfterMs = Math.max(0, resetTime - nowMs);
                } else {
                    const targetElapsedNew = windowMs * (1 - targetNewWeight);
                    retryAfterMs = Math.max(0, resetTime + targetElapsedNew - nowMs);
                }
            }
        }

        // Store state
        const fields = new Map<string, string>([
            ['curr', String(currentHits)],
            ['prev', String(previousHits)],
            ['windowStart', String(windowStart)]
        ]);
        store.set(key, { value: '', fields, expiresAt: nowMs + windowMs * 2 });

        return [limited, remaining, resetTime, retryAfterMs];
    }

    function executeSlidingWindowPeek(key: string, argv: string[]): RedisReply {
        const entry = getEntry(key);
        if (!entry || !entry.fields) return [-1];

        const windowMs = Number(argv[0]);
        const limit = Number(argv[1]);
        const nowMs = Number(argv[2]);

        let currentHits = Number(entry.fields.get('curr') ?? '0');
        let previousHits = Number(entry.fields.get('prev') ?? '0');
        let windowStart = Number(entry.fields.get('windowStart') ?? '0');

        if (nowMs >= windowStart + windowMs) {
            if (nowMs < windowStart + 2 * windowMs) {
                previousHits = currentHits;
                currentHits = 0;
                windowStart = windowStart + windowMs;
            } else {
                previousHits = 0;
                currentHits = 0;
            }
        }

        const elapsed = nowMs - windowStart;
        const weight = Math.max(0, 1 - elapsed / windowMs);
        const totalHits = Math.ceil(previousHits * weight + currentHits);
        const remaining = Math.max(0, limit - totalHits);
        const resetTime = windowStart + windowMs;

        return [0, remaining, resetTime, 0]; // peek never says limited
    }

    // ── Token Bucket Lua emulation ──

    function executeTokenBucketConsume(key: string, argv: string[]): RedisReply {
        const refillRate = Number(argv[0]);
        const capacity = Number(argv[1]);
        const nowMs = Number(argv[2]);
        const cost = Number(argv[3]) || 1;
        const refillMs = Number(argv[4]) || 1000;

        const entry = getEntry(key);
        let tokens: number;
        let lastRefillTime: number;

        if (!entry || !entry.fields) {
            // First request: start with full bucket, deduct cost
            tokens = capacity - cost;
            lastRefillTime = nowMs;
        } else {
            tokens = Number(entry.fields.get('tokens') ?? String(capacity));
            lastRefillTime = Number(entry.fields.get('lastRefillMs') ?? String(nowMs));

            // Refill using refillMs instead of hardcoded 1000
            const elapsed = nowMs - lastRefillTime;
            const refilled = (elapsed / refillMs) * refillRate;
            tokens = Math.min(capacity, tokens + refilled);
            lastRefillTime = nowMs;

            // Consume
            if (tokens >= cost) {
                tokens -= cost;
            } else {
                // Not enough tokens — limited, remaining=0
                const retryAfterMs = Math.ceil(((cost - tokens) / refillRate) * refillMs);
                const resetTime = nowMs + Math.ceil(((capacity - tokens) / refillRate) * refillMs);

                const fields = new Map<string, string>([
                    ['tokens', String(tokens)],
                    ['lastRefillMs', String(lastRefillTime)]
                ]);
                const ttlMs = Math.ceil((capacity / refillRate) * refillMs);
                store.set(key, { value: '', fields, expiresAt: nowMs + ttlMs });

                return [1, 0, resetTime, retryAfterMs];
            }
        }

        const remaining = Math.max(0, Math.floor(tokens));
        const resetTime = nowMs + Math.ceil(((capacity - tokens) / refillRate) * refillMs);

        // Store state
        const fields = new Map<string, string>([
            ['tokens', String(tokens)],
            ['lastRefillMs', String(lastRefillTime)]
        ]);
        const ttlMs = Math.ceil((capacity / refillRate) * refillMs);
        store.set(key, { value: '', fields, expiresAt: nowMs + ttlMs });

        return [0, remaining, resetTime, 0];
    }

    function executeTokenBucketPeek(key: string, argv: string[]): RedisReply {
        const entry = getEntry(key);
        if (!entry || !entry.fields) return [-1];

        const refillRate = Number(argv[0]);
        const capacity = Number(argv[1]);
        const nowMs = Number(argv[2]);
        const refillMs = Number(argv[3]) || 1000;

        let tokens = Number(entry.fields.get('tokens') ?? String(capacity));
        const lastRefillTime = Number(entry.fields.get('lastRefillMs') ?? String(nowMs));

        // Refill (read-only) using refillMs instead of hardcoded 1000
        const elapsed = nowMs - lastRefillTime;
        const refilled = (elapsed / refillMs) * refillRate;
        tokens = Math.min(capacity, tokens + refilled);

        const remaining = Math.max(0, Math.floor(tokens));
        const resetTime = nowMs + Math.ceil(((capacity - tokens) / refillRate) * refillMs);
        return [0, remaining, resetTime, 0];
    }

    return { sendCommand, store, scripts };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RedisStore', () => {
    let mock: ReturnType<typeof createMockRedis>;
    let redisStore: RedisStore;

    beforeEach(() => {
        mock = createMockRedis();
        redisStore = new RedisStore({
            sendCommand: mock.sendCommand
        });
    });

    describe('fixed-window algorithm', () => {
        const algo = fixedWindow({ windowMs: 60_000 });

        it('first consume returns remaining = limit - 1', async () => {
            const result = await redisStore.consume('test-key', algo, 10);

            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(9);
            expect(result.resetTime).toBeInstanceOf(Date);
            expect(result.retryAfterMs).toBe(0);
        });

        it('subsequent consume calls decrement remaining', async () => {
            const r1 = await redisStore.consume('test-key', algo, 10);
            const r2 = await redisStore.consume('test-key', algo, 10);
            const r3 = await redisStore.consume('test-key', algo, 10);

            expect(r1.remaining).toBe(9);
            expect(r2.remaining).toBe(8);
            expect(r3.remaining).toBe(7);
        });

        it('limits when hits exceed limit', async () => {
            for (let i = 0; i < 10; i++) {
                await redisStore.consume('test-key', algo, 10);
            }

            const result = await redisStore.consume('test-key', algo, 10);
            expect(result.limited).toBe(true);
            expect(result.remaining).toBe(0);
            expect(result.retryAfterMs).toBeGreaterThan(0);
        });

        it('resets after window expires', async () => {
            vi.useFakeTimers();
            try {
                const shortAlgo = fixedWindow({ windowMs: 1000 });
                await redisStore.consume('test-key', shortAlgo, 10);
                await redisStore.consume('test-key', shortAlgo, 10);

                vi.advanceTimersByTime(1500);

                const result = await redisStore.consume('test-key', shortAlgo, 10);
                expect(result.remaining).toBe(9);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('sliding-window algorithm', () => {
        const algo = slidingWindow({ windowMs: 60_000 });

        it('first consume returns remaining = limit - 1', async () => {
            const result = await redisStore.consume('test-key', algo, 10);

            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(9);
        });

        it('subsequent consume calls decrement remaining', async () => {
            const r1 = await redisStore.consume('test-key', algo, 10);
            const r2 = await redisStore.consume('test-key', algo, 10);

            expect(r1.remaining).toBe(9);
            expect(r2.remaining).toBe(8);
        });

        it('limits when hits exceed limit', async () => {
            for (let i = 0; i < 10; i++) {
                await redisStore.consume('test-key', algo, 10);
            }

            const result = await redisStore.consume('test-key', algo, 10);
            expect(result.limited).toBe(true);
            expect(result.remaining).toBe(0);
        });
    });

    describe('token-bucket algorithm', () => {
        const algo = tokenBucket({ refillRate: 10 });

        it('first consume returns remaining = limit - 1', async () => {
            const result = await redisStore.consume('test-key', algo, 10);

            expect(result.limited).toBe(false);
            expect(result.remaining).toBe(9);
        });

        it('limits when tokens exhausted', async () => {
            vi.useFakeTimers();
            try {
                for (let i = 0; i < 10; i++) {
                    await redisStore.consume('test-key', algo, 10);
                }

                const result = await redisStore.consume('test-key', algo, 10);
                expect(result.limited).toBe(true);
                expect(result.remaining).toBe(0);
                expect(result.retryAfterMs).toBe(100); // 1/10 * 1000 = 100ms
            } finally {
                vi.useRealTimers();
            }
        });

        it('refills over time', async () => {
            vi.useFakeTimers();
            try {
                // Exhaust all tokens
                for (let i = 0; i < 10; i++) {
                    await redisStore.consume('test-key', algo, 10);
                }

                // Wait 200ms -> 10 * 0.2 = 2 tokens
                vi.advanceTimersByTime(200);
                const result = await redisStore.consume('test-key', algo, 10);
                expect(result.limited).toBe(false);
                expect(result.remaining).toBe(1); // 2 refilled, 1 consumed
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('unknown algorithm', () => {
        it('throws error for unknown algorithm name', async () => {
            const unknownAlgo: Algorithm = {
                name: 'unknown-algo',
                config: {},
                consume() {
                    return { next: undefined, result: { limited: false, remaining: 0, resetTime: new Date(), retryAfterMs: 0 } };
                },
                ttlMs() {
                    return 1000;
                }
            };

            await expect(redisStore.consume('test-key', unknownAlgo, 10)).rejects.toThrow(/unsupported|unknown/i);
        });
    });

    describe('key management', () => {
        const algo = fixedWindow({ windowMs: 60_000 });

        it('resetKey clears key and next consume starts fresh', async () => {
            await redisStore.consume('test-key', algo, 10);
            await redisStore.consume('test-key', algo, 10);

            await redisStore.resetKey('test-key');

            const result = await redisStore.consume('test-key', algo, 10);
            expect(result.remaining).toBe(9);
        });

        it('resetAll clears all prefixed keys', async () => {
            await redisStore.consume('key-a', algo, 10);
            await redisStore.consume('key-b', algo, 10);
            await redisStore.consume('key-c', algo, 10);

            expect(mock.store.size).toBe(3);

            await redisStore.resetAll();

            expect(mock.store.size).toBe(0);
        });

        it('uses custom prefix', async () => {
            const customStore = new RedisStore({
                sendCommand: mock.sendCommand,
                prefix: 'custom:'
            });

            await customStore.consume('my-key', algo, 10);

            expect(mock.store.has('custom:my-key')).toBe(true);
            expect(mock.store.has('rl:my-key')).toBe(false);
        });
    });

    describe('NOSCRIPT retry', () => {
        it('retries on NOSCRIPT error', async () => {
            const algo = fixedWindow({ windowMs: 60_000 });

            // First call loads the script
            await redisStore.consume('test-key', algo, 10);

            // Clear scripts to simulate cache eviction
            mock.scripts.clear();

            // Should retry with EVAL and succeed
            const result = await redisStore.consume('test-key', algo, 10);
            expect(result.remaining).toBe(8);
        });

        it('propagates non-NOSCRIPT errors', async () => {
            const failingStore = new RedisStore({
                sendCommand: async (...args: string[]) => {
                    if (args[0] === 'SCRIPT') return 'fake-sha';
                    throw new Error('Connection refused');
                }
            });

            const algo = fixedWindow({ windowMs: 60_000 });
            await expect(failingStore.consume('test-key', algo, 10)).rejects.toThrow('Connection refused');
        });
    });

    describe('integration with core rateLimit()', () => {
        it('works with fixed-window through rateLimit()', async () => {
            const limiter = rateLimit({
                limit: 3,
                algorithm: { type: 'fixed-window', windowMs: 60_000 },
                store: redisStore
            });

            const request = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '1.2.3.4' }
            });

            const r1 = await limiter(request);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(2);

            const r2 = await limiter(request);
            expect(r2.remaining).toBe(1);

            const r3 = await limiter(request);
            expect(r3.remaining).toBe(0);

            const r4 = await limiter(request);
            expect(r4.limited).toBe(true);
            expect(r4.remaining).toBe(0);
        });

        it('works with token-bucket through rateLimit()', async () => {
            const limiter = rateLimit({
                limit: 3,
                algorithm: { type: 'token-bucket', refillRate: 10 },
                store: redisStore
            });

            const request = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '1.2.3.4' }
            });

            const r1 = await limiter(request);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(2);

            const r2 = await limiter(request);
            expect(r2.remaining).toBe(1);

            const r3 = await limiter(request);
            expect(r3.remaining).toBe(0);

            const r4 = await limiter(request);
            expect(r4.limited).toBe(true);
        });
    });

    // ── Hardened interface tests ─────────────────────────────────────────

    describe('cost-based consumption', () => {
        it('fixed-window consume with cost=2 deducts 2 hits', async () => {
            const algo = fixedWindow({ windowMs: 60_000 });

            const r1 = await redisStore.consume('test-key', algo, 10);
            expect(r1.remaining).toBe(9);

            // cost=2 should deduct 2 hits
            const r2 = await redisStore.consume('test-key', algo, 10, 2);
            expect(r2.remaining).toBe(7); // 10 - (1 + 2) = 7
        });

        it('sliding-window consume with cost=2 deducts 2 hits', async () => {
            const algo = slidingWindow({ windowMs: 60_000 });

            const r1 = await redisStore.consume('test-key', algo, 10);
            expect(r1.remaining).toBe(9);

            const r2 = await redisStore.consume('test-key', algo, 10, 2);
            expect(r2.remaining).toBe(7);
        });

        it('token-bucket consume with cost=2 deducts 2 tokens', async () => {
            const algo = tokenBucket({ refillRate: 10 });

            const r1 = await redisStore.consume('test-key', algo, 10);
            expect(r1.remaining).toBe(9);

            const r2 = await redisStore.consume('test-key', algo, 10, 2);
            expect(r2.remaining).toBe(7); // 9 - 2 = 7
        });

        it('default cost=1 behavior is unchanged', async () => {
            const algo = fixedWindow({ windowMs: 60_000 });

            const r1 = await redisStore.consume('test-key', algo, 10);
            expect(r1.remaining).toBe(9);

            const r2 = await redisStore.consume('test-key', algo, 10);
            expect(r2.remaining).toBe(8);
        });

        it('blocks when cost exceeds remaining tokens', async () => {
            const algo = tokenBucket({ refillRate: 10 });

            // Exhaust 9 tokens
            for (let i = 0; i < 9; i++) {
                await redisStore.consume('test-key', algo, 10);
            }

            // cost=2 but only 1 token left
            const result = await redisStore.consume('test-key', algo, 10, 2);
            expect(result.limited).toBe(true);
            expect(result.remaining).toBe(0);
        });
    });

    describe('tokenBucket with bucketSize', () => {
        it('bucketSize limits capacity independently from limit', async () => {
            const algo = tokenBucket({ refillRate: 10, bucketSize: 5 });

            const r1 = await redisStore.consume('test-key', algo, 100);
            expect(r1.limited).toBe(false);
            expect(r1.remaining).toBe(4); // bucket=5, consumed 1 → 4
        });

        it('blocks when bucketSize tokens exhausted despite high limit', async () => {
            const algo = tokenBucket({ refillRate: 10, bucketSize: 3 });

            for (let i = 0; i < 3; i++) {
                await redisStore.consume('test-key', algo, 100);
            }

            const result = await redisStore.consume('test-key', algo, 100);
            expect(result.limited).toBe(true);
            expect(result.remaining).toBe(0);
        });

        it('refills up to bucketSize, not limit', async () => {
            vi.useFakeTimers();
            try {
                const algo = tokenBucket({ refillRate: 10, bucketSize: 5 });

                // Exhaust all 5 tokens
                for (let i = 0; i < 5; i++) {
                    await redisStore.consume('test-key', algo, 100);
                }

                // Wait 2 seconds — would refill 20 tokens but capped at bucketSize=5
                vi.advanceTimersByTime(2000);

                const result = await redisStore.consume('test-key', algo, 100);
                expect(result.limited).toBe(false);
                expect(result.remaining).toBe(4); // min(5, refilled) - 1 = 4
            } finally {
                vi.useRealTimers();
            }
        });

        it('works through rateLimit factory with bucketSize', async () => {
            const limiter = rateLimit({
                limit: 100,
                algorithm: { type: 'token-bucket', refillRate: 10, bucketSize: 2 },
                store: redisStore
            });

            const request = new Request('http://localhost/', {
                headers: { 'x-forwarded-for': '1.2.3.4' }
            });

            const r1 = await limiter(request);
            expect(r1.remaining).toBe(1);

            const r2 = await limiter(request);
            expect(r2.remaining).toBe(0);

            const r3 = await limiter(request);
            expect(r3.limited).toBe(true);
        });
    });

    describe('tokenBucket with refillMs (9.3a.10)', () => {
        it('Redis Lua script uses refillMs instead of hardcoded 1000ms', async () => {
            vi.useFakeTimers();
            try {
                // refillRate=10 per 30_000ms = 10 tokens every 30 seconds
                const algo = tokenBucket({ refillRate: 10, refillMs: 30_000 });

                // Exhaust all 10 tokens (limit=10, so capacity=10)
                for (let i = 0; i < 10; i++) {
                    const result = await redisStore.consume('refill-test', algo, 10);
                    expect(result.limited).toBe(false);
                }

                // Now limited — 0 tokens left
                const limited = await redisStore.consume('refill-test', algo, 10);
                expect(limited.limited).toBe(true);
                expect(limited.remaining).toBe(0);

                // Wait 3000ms — with refillMs=30_000 that's 3000/30000 * 10 = 1 token
                vi.advanceTimersByTime(3000);

                const afterRefill = await redisStore.consume('refill-test', algo, 10);
                expect(afterRefill.limited).toBe(false);
                expect(afterRefill.remaining).toBe(0); // had 1 token, consumed 1 = 0 remaining

                // Wait another 3000ms — another 1 token
                vi.advanceTimersByTime(3000);

                const afterRefill2 = await redisStore.consume('refill-test', algo, 10);
                expect(afterRefill2.limited).toBe(false);
                expect(afterRefill2.remaining).toBe(0);

                // Confirm NOT getting 10 tokens back in 1 second (would happen if using 1000ms)
                // Reset and re-exhaust
                await redisStore.resetKey('refill-test');
                for (let i = 0; i < 10; i++) {
                    await redisStore.consume('refill-test', algo, 10);
                }

                // Wait 1 second — only 10 * (1000/30000) = 0.33 tokens, not enough
                vi.advanceTimersByTime(1000);

                const stillLimited = await redisStore.consume('refill-test', algo, 10);
                expect(stillLimited.limited).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });

        it('peek uses refillMs for token refill calculation', async () => {
            vi.useFakeTimers();
            try {
                const algo = tokenBucket({ refillRate: 10, refillMs: 30_000 });

                // Exhaust all tokens
                for (let i = 0; i < 10; i++) {
                    await redisStore.consume('peek-refill', algo, 10);
                }

                // Wait 15 seconds — should refill 10 * (15000/30000) = 5 tokens
                vi.advanceTimersByTime(15_000);

                const peeked = await redisStore.peek('peek-refill', algo, 10);
                expect(peeked).toBeDefined();
                expect(peeked!.remaining).toBe(5);
                expect(peeked!.limited).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
