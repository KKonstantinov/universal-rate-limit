import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { RedisStore } from '../src/index.js';
import type { SendCommandFn, RedisReply } from '../src/index.js';
import { rateLimit } from 'universal-rate-limit';
import { INCREMENT_SCRIPT, GET_SCRIPT } from '../src/scripts.js';

// ── Mock Redis ──────────────────────────────────────────────────────────────

interface MockEntry {
    value: string;
    expiresAt: number;
}

function sha1(script: string): string {
    return createHash('sha1').update(script).digest('hex');
}

/**
 * Creates a mock sendCommand that simulates Redis in-memory.
 * Supports: SCRIPT LOAD, EVALSHA, DECR, DEL, SCAN, GET, PTTL, SET, INCR, PEXPIRE
 */
function createMockRedis(options?: { failNextEvalsha?: boolean }): {
    sendCommand: SendCommandFn;
    store: Map<string, MockEntry>;
    scripts: Map<string, string>;
    failNextEvalsha: boolean;
} {
    const store = new Map<string, MockEntry>();
    const scripts = new Map<string, string>();
    let failNextEvalsha = options?.failNextEvalsha ?? false;

    function getEntry(key: string): MockEntry | undefined {
        const entry = store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
            store.delete(key);
            return undefined;
        }
        return entry;
    }

    const sendCommand: SendCommandFn = async (...args: string[]): Promise<RedisReply> => {
        const command = args[0].toUpperCase();

        switch (command) {
            case 'SCRIPT': {
                // SCRIPT LOAD <script>
                const script = args[2];
                const hash = sha1(script);
                scripts.set(hash, script);
                return hash;
            }
            case 'EVALSHA': {
                const evalSha = args[1];

                if (failNextEvalsha) {
                    failNextEvalsha = false;
                    mock.failNextEvalsha = false;
                    throw new Error('NOSCRIPT No matching script. Please use EVAL.');
                }

                const script = scripts.get(evalSha);
                if (!script) {
                    throw new Error('NOSCRIPT No matching script. Please use EVAL.');
                }

                // Parse: EVALSHA <sha> <numkeys> <key> [args...]
                const numKeys = Number(args[2]);
                const keys = args.slice(3, 3 + numKeys);
                const argv = args.slice(3 + numKeys);

                return executeLuaScript(script, keys, argv);
            }
            case 'DECR': {
                const key = args[1];
                const entry = getEntry(key);
                if (!entry) {
                    store.set(key, { value: '-1', expiresAt: -1 });
                    return -1;
                }
                const newVal = Number(entry.value) - 1;
                entry.value = String(newVal);
                return newVal;
            }
            case 'DEL': {
                let deleted = 0;
                for (let i = 1; i < args.length; i++) {
                    if (store.delete(args[i])) deleted++;
                }
                return deleted;
            }
            case 'SCAN': {
                // SCAN <cursor> MATCH <pattern> COUNT <count>
                const pattern = args[3];
                const prefix = pattern.replace('*', '');
                const matchingKeys: string[] = [];
                for (const key of store.keys()) {
                    if (key.startsWith(prefix)) {
                        const entry = getEntry(key);
                        if (entry) matchingKeys.push(key);
                    }
                }
                // Return all matching keys in one batch (cursor "0" = done)
                return ['0', matchingKeys];
            }
            default: {
                throw new Error(`Mock Redis: unsupported command "${command}"`);
            }
        }
    };

    function executeLuaScript(script: string, keys: string[], argv: string[]): RedisReply {
        // Determine which script by matching against known scripts
        const incrementHash = sha1(INCREMENT_SCRIPT);
        const getHash = sha1(GET_SCRIPT);
        const scriptHash = sha1(script);

        if (scriptHash === incrementHash) {
            return executeIncrementScript(keys[0], argv);
        }
        if (scriptHash === getHash) {
            return executeGetScript(keys[0]);
        }

        throw new Error('Mock Redis: unknown script');
    }

    function executeIncrementScript(key: string, argv: string[]): RedisReply {
        const windowMs = Number(argv[0]);
        const resetExpiry = argv[1] === '1';

        const entry = getEntry(key);

        if (!entry) {
            // Key doesn't exist or expired — set to 1 with TTL
            store.set(key, { value: '1', expiresAt: Date.now() + windowMs });
            return [1, windowMs];
        }

        // PTTL
        const ttl = entry.expiresAt > 0 ? Math.max(0, entry.expiresAt - Date.now()) : -1;

        if (ttl <= 0) {
            // Expired — reset
            store.set(key, { value: '1', expiresAt: Date.now() + windowMs });
            return [1, windowMs];
        }

        // INCR
        const totalHits = Number(entry.value) + 1;
        entry.value = String(totalHits);

        if (resetExpiry) {
            entry.expiresAt = Date.now() + windowMs;
            return [totalHits, windowMs];
        }

        return [totalHits, ttl];
    }

    function executeGetScript(key: string): RedisReply {
        const entry = getEntry(key);
        if (!entry) return [-1, -1];
        const ttl = entry.expiresAt > 0 ? Math.max(0, entry.expiresAt - Date.now()) : -1;
        return [Number(entry.value), ttl];
    }

    const mock = { sendCommand, store, scripts, failNextEvalsha };
    return mock;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RedisStore', () => {
    let mock: ReturnType<typeof createMockRedis>;
    let redisStore: RedisStore;

    beforeEach(() => {
        mock = createMockRedis();
        redisStore = new RedisStore({
            sendCommand: mock.sendCommand,
            windowMs: 60_000
        });
    });

    it('increment first call returns totalHits=1 and resetTime near now + windowMs', async () => {
        const before = Date.now();
        const result = await redisStore.increment('test-key');
        const after = Date.now();

        expect(result.totalHits).toBe(1);
        expect(result.resetTime.getTime()).toBeGreaterThanOrEqual(before + 60_000);
        expect(result.resetTime.getTime()).toBeLessThanOrEqual(after + 60_000);
    });

    it('increment subsequent calls increase totalHits', async () => {
        const r1 = await redisStore.increment('test-key');
        const r2 = await redisStore.increment('test-key');
        const r3 = await redisStore.increment('test-key');

        expect(r1.totalHits).toBe(1);
        expect(r2.totalHits).toBe(2);
        expect(r3.totalHits).toBe(3);
    });

    it('increment after window expires resets to 1', async () => {
        vi.useFakeTimers();
        try {
            const shortStore = new RedisStore({
                sendCommand: mock.sendCommand,
                windowMs: 1000
            });

            const r1 = await shortStore.increment('test-key');
            expect(r1.totalHits).toBe(1);

            const r2 = await shortStore.increment('test-key');
            expect(r2.totalHits).toBe(2);

            // Advance past the window
            vi.advanceTimersByTime(1500);

            const r3 = await shortStore.increment('test-key');
            expect(r3.totalHits).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('decrement reduces count', async () => {
        await redisStore.increment('test-key');
        await redisStore.increment('test-key');
        await redisStore.increment('test-key');

        await redisStore.decrement('test-key');

        // The underlying value should now be 2
        const entry = mock.store.get('rl:test-key');
        expect(entry).toBeDefined();
        expect(Number(entry!.value)).toBe(2);
    });

    it('resetKey clears key and next increment starts at 1', async () => {
        await redisStore.increment('test-key');
        await redisStore.increment('test-key');

        await redisStore.resetKey('test-key');

        const result = await redisStore.increment('test-key');
        expect(result.totalHits).toBe(1);
    });

    it('resetAll clears all prefixed keys', async () => {
        await redisStore.increment('key-a');
        await redisStore.increment('key-b');
        await redisStore.increment('key-c');

        expect(mock.store.size).toBe(3);

        await redisStore.resetAll();

        expect(mock.store.size).toBe(0);
    });

    it('uses custom prefix', async () => {
        const customStore = new RedisStore({
            sendCommand: mock.sendCommand,
            windowMs: 60_000,
            prefix: 'custom:'
        });

        await customStore.increment('my-key');

        expect(mock.store.has('custom:my-key')).toBe(true);
        expect(mock.store.has('rl:my-key')).toBe(false);
    });

    it('resetExpiryOnChange resets TTL on each increment', async () => {
        vi.useFakeTimers();
        try {
            const resetStore = new RedisStore({
                sendCommand: mock.sendCommand,
                windowMs: 10_000,
                resetExpiryOnChange: true
            });

            await resetStore.increment('test-key');

            // Advance 8 seconds (within window)
            vi.advanceTimersByTime(8000);

            const r2 = await resetStore.increment('test-key');
            expect(r2.totalHits).toBe(2);
            // TTL should have been reset to full windowMs
            expect(r2.resetTime.getTime()).toBeGreaterThanOrEqual(Date.now() + 9000);

            // Advance another 8 seconds — should still be alive because TTL was reset
            vi.advanceTimersByTime(8000);

            const r3 = await resetStore.increment('test-key');
            expect(r3.totalHits).toBe(3); // Not reset because expiry was refreshed
        } finally {
            vi.useRealTimers();
        }
    });

    it('retries on NOSCRIPT error (script cache miss)', async () => {
        // First, do a normal increment to load the script
        await redisStore.increment('test-key');

        // Clear the scripts cache to simulate a Redis restart/cache eviction
        mock.scripts.clear();

        // The next EVALSHA should fail with NOSCRIPT, trigger a reload, and succeed
        const result = await redisStore.increment('test-key');
        // Key data still exists — count continues from where it was
        expect(result.totalHits).toBe(2);
    });

    it('propagates non-NOSCRIPT errors', async () => {
        const failingStore = new RedisStore({
            sendCommand: async (...args: string[]) => {
                if (args[0] === 'SCRIPT') return 'fake-sha';
                throw new Error('Connection refused');
            },
            windowMs: 60_000
        });

        await expect(failingStore.increment('test-key')).rejects.toThrow('Connection refused');
    });

    it('integrates with core rateLimit() function', async () => {
        const limiter = rateLimit({
            windowMs: 60_000,
            limit: 3,
            store: redisStore
        });

        const request = new Request('http://localhost/', {
            headers: { 'x-forwarded-for': '1.2.3.4' }
        });

        const r1 = await limiter(request);
        expect(r1.limited).toBe(false);
        expect(r1.remaining).toBe(2);

        const r2 = await limiter(request);
        expect(r2.limited).toBe(false);
        expect(r2.remaining).toBe(1);

        const r3 = await limiter(request);
        expect(r3.limited).toBe(false);
        expect(r3.remaining).toBe(0);

        const r4 = await limiter(request);
        expect(r4.limited).toBe(true);
        expect(r4.remaining).toBe(0);
    });
});
