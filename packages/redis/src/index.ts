import type { Store, Algorithm, ConsumeResult } from 'universal-rate-limit';
import {
    FIXED_WINDOW_CONSUME,
    FIXED_WINDOW_PEEK,
    SLIDING_WINDOW_CONSUME,
    SLIDING_WINDOW_PEEK,
    TOKEN_BUCKET_CONSUME,
    TOKEN_BUCKET_PEEK
} from './scripts.js';

// ── Re-exports from core ────────────────────────────────────────────────────

export type { Store, ConsumeResult, Algorithm, AlgorithmConfig, MemoryStoreOptions } from 'universal-rate-limit';
export { fixedWindow, slidingWindow, tokenBucket } from 'universal-rate-limit';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * A value that can be returned from a raw Redis command.
 *
 * Redis replies are recursively typed — simple commands return `string | number | null`,
 * while multi-bulk replies (e.g. `EVALSHA`) return nested arrays.
 */
export type RedisReply = string | number | null | RedisReply[];

/**
 * A function that sends a raw Redis command and returns the reply.
 *
 * This abstraction allows {@link RedisStore} to work with any Redis client
 * library — simply wrap the client's `sendCommand` or equivalent method.
 *
 * @example
 * ```ts
 * import { createClient } from 'redis';
 * const client = createClient();
 * const sendCommand: SendCommandFn = (...args) => client.sendCommand(args);
 * ```
 */
export type SendCommandFn = (...args: string[]) => Promise<RedisReply>;

/** Configuration options for {@link RedisStore}. */
export interface RedisStoreOptions {
    /** Function that sends a raw Redis command. See {@link SendCommandFn}. */
    sendCommand: SendCommandFn;
    /** Key prefix prepended to every rate limit key in Redis. @default 'rl:' */
    prefix?: string;
}

// ── Script handler registry ─────────────────────────────────────────────────

/** Maps an algorithm name to its Lua scripts and argument/result serializers for Redis execution. */
interface ScriptHandler {
    /** Lua script source for the consume (increment + check) operation. */
    consumeScript: string;
    /** Lua script source for the peek (read-only check) operation. */
    peekScript: string;
    /** Build the KEYS + ARGV array for the consume Lua script. */
    buildConsumeArgs(fullKey: string, algorithm: Algorithm, limit: number, nowMs: number, cost: number): string[];
    /** Build the KEYS + ARGV array for the peek Lua script. */
    buildPeekArgs(fullKey: string, algorithm: Algorithm, limit: number, nowMs: number): string[];
    /** Parse the Redis reply from the consume script into a {@link ConsumeResult}. */
    parseConsumeResult(reply: RedisReply, nowMs: number): ConsumeResult;
    /** Parse the Redis reply from the peek script into a {@link ConsumeResult}, or `null` if the key does not exist. */
    parsePeekResult(reply: RedisReply, nowMs: number): ConsumeResult | null;
}

function assertArrayReply(reply: RedisReply, minLength: number, context: string): asserts reply is RedisReply[] {
    if (!Array.isArray(reply) || reply.length < minLength) {
        throw new Error(`Unexpected Redis ${context} reply: ${String(reply)}`);
    }
}

function assertFinite(value: number, context: string): void {
    if (!Number.isFinite(value)) {
        throw new TypeError(`Non-numeric value in Redis ${context} reply: ${String(value)}`);
    }
}

/**
 * All Lua scripts return a unified 4-element array:
 * [limited (0/1), remaining, resetTime (absolute ms), retryAfterMs]
 *
 * Peek scripts return [-1] when the key doesn't exist.
 * Token bucket scripts return resetTime as msUntilFull (relative), so
 * the parser adds nowMs to produce an absolute timestamp.
 */

const fixedWindowHandler: ScriptHandler = {
    consumeScript: FIXED_WINDOW_CONSUME,
    peekScript: FIXED_WINDOW_PEEK,

    buildConsumeArgs(fullKey, algorithm, limit, nowMs, cost) {
        const windowMs = algorithm.config.windowMs;
        return [fullKey, String(windowMs), String(limit), String(nowMs), String(cost)];
    },

    buildPeekArgs(fullKey, _algorithm, limit, nowMs) {
        return [fullKey, String(limit), String(nowMs)];
    },

    parseConsumeResult(reply) {
        const result = parseUnifiedResult(reply);
        if (!result) throw new Error('Unexpected null from fixed-window consume');
        return result;
    },
    parsePeekResult(reply) {
        return parseUnifiedResult(reply);
    }
};

const slidingWindowHandler: ScriptHandler = {
    consumeScript: SLIDING_WINDOW_CONSUME,
    peekScript: SLIDING_WINDOW_PEEK,

    buildConsumeArgs(fullKey, algorithm, limit, nowMs, cost) {
        const windowMs = algorithm.config.windowMs;
        return [fullKey, String(windowMs), String(limit), String(nowMs), String(cost)];
    },

    buildPeekArgs(fullKey, algorithm, limit, nowMs) {
        const windowMs = algorithm.config.windowMs;
        return [fullKey, String(windowMs), String(limit), String(nowMs)];
    },

    parseConsumeResult(reply) {
        const result = parseUnifiedResult(reply);
        if (!result) throw new Error('Unexpected null from sliding-window consume');
        return result;
    },
    parsePeekResult(reply) {
        return parseUnifiedResult(reply);
    }
};

const tokenBucketHandler: ScriptHandler = {
    consumeScript: TOKEN_BUCKET_CONSUME,
    peekScript: TOKEN_BUCKET_PEEK,

    buildConsumeArgs(fullKey, algorithm, limit, nowMs, cost) {
        const refillRate = algorithm.config.refillRate;
        const refillMs = 'refillMs' in algorithm.config ? Number(algorithm.config.refillMs) : 1000;
        const capacity = 'bucketSize' in algorithm.config ? Number(algorithm.config.bucketSize) : limit;
        return [fullKey, String(refillRate), String(capacity), String(nowMs), String(cost), String(refillMs)];
    },

    buildPeekArgs(fullKey, algorithm, limit, nowMs) {
        const refillRate = algorithm.config.refillRate;
        const refillMs = 'refillMs' in algorithm.config ? Number(algorithm.config.refillMs) : 1000;
        const capacity = 'bucketSize' in algorithm.config ? Number(algorithm.config.bucketSize) : limit;
        return [fullKey, String(refillRate), String(capacity), String(nowMs), String(refillMs)];
    },

    parseConsumeResult(reply) {
        const result = parseUnifiedResult(reply);
        if (!result) throw new Error('Unexpected null from token-bucket consume');
        return result;
    },

    parsePeekResult(reply) {
        return parseUnifiedResult(reply);
    }
};

/**
 * Parses the unified [limited, remaining, resetTime, retryAfterMs] reply
 * used by fixed-window and sliding-window consume scripts.
 */
function parseUnifiedResult(reply: RedisReply): ConsumeResult | null {
    if (Array.isArray(reply) && reply.length === 1 && Number(reply[0]) === -1) return null;
    assertArrayReply(reply, 4, 'unified');
    const limited = Number(reply[0]) === 1;
    const remaining = Number(reply[1]);
    const resetTimeMs = Number(reply[2]);
    const retryAfterMs = Number(reply[3]);
    assertFinite(remaining, 'unified');
    assertFinite(resetTimeMs, 'unified');
    assertFinite(retryAfterMs, 'unified');
    return { limited, remaining, resetTime: new Date(resetTimeMs), retryAfterMs };
}

const SCRIPT_REGISTRY = new Map<string, ScriptHandler>([
    ['fixed-window', fixedWindowHandler],
    ['sliding-window', slidingWindowHandler],
    ['token-bucket', tokenBucketHandler]
]);

// ── RedisStore ──────────────────────────────────────────────────────────────

/**
 * Redis-backed rate limit store that uses atomic Lua scripts for
 * thread-safe, distributed rate limiting.
 *
 * Scripts are loaded once via `SCRIPT LOAD` and executed with `EVALSHA`.
 * If the script is evicted from the Redis script cache, the store
 * automatically reloads and retries.
 *
 * @example
 * ```ts
 * import { createClient } from 'redis';
 * import { RedisStore } from '@universal-rate-limit/redis';
 *
 * const client = createClient();
 * await client.connect();
 *
 * const store = new RedisStore({
 *   sendCommand: (...args) => client.sendCommand(args),
 * });
 * ```
 */
export class RedisStore implements Store {
    private readonly sendCommand: SendCommandFn;
    readonly prefix: string;

    private readonly shaPromises = new Map<string, Promise<string>>();

    /**
     * Create a new Redis-backed rate limit store.
     *
     * @param options - Configuration for the Redis store. See {@link RedisStoreOptions}.
     */
    constructor(options: RedisStoreOptions) {
        this.sendCommand = options.sendCommand;
        this.prefix = options.prefix ?? 'rl:';
    }

    /**
     * Consume rate limit capacity for the given key.
     *
     * Executes the algorithm-specific Lua script atomically in Redis.
     *
     * @param key - The rate limit key (e.g. client IP). The configured {@link RedisStoreOptions.prefix | prefix} is prepended automatically.
     * @param algorithm - The rate limiting algorithm to use (e.g. from {@link fixedWindow}, {@link slidingWindow}, or {@link tokenBucket}).
     * @param limit - The maximum number of requests allowed in the window.
     * @param cost - Number of units to consume. @default 1
     * @returns The consume result indicating whether the request is limited and how much capacity remains.
     */
    async consume(key: string, algorithm: Algorithm, limit: number, cost = 1): Promise<ConsumeResult> {
        const handler = this.getHandler(algorithm.name);
        const fullKey = this.prefix + key;
        const nowMs = Date.now();

        const args = handler.buildConsumeArgs(fullKey, algorithm, limit, nowMs, cost);
        const reply = await this.evalScript(handler.consumeScript, args);
        return handler.parseConsumeResult(reply, nowMs);
    }

    /**
     * Peek at the current rate limit state without consuming any capacity.
     *
     * @param key - The rate limit key. The configured {@link RedisStoreOptions.prefix | prefix} is prepended automatically.
     * @param algorithm - The rate limiting algorithm to use.
     * @param limit - The maximum number of requests allowed in the window.
     * @returns The current state, or `undefined` if the key does not exist in Redis.
     */
    async peek(key: string, algorithm: Algorithm, limit: number): Promise<ConsumeResult | undefined> {
        const handler = this.getHandler(algorithm.name);
        const fullKey = this.prefix + key;
        const nowMs = Date.now();
        const args = handler.buildPeekArgs(fullKey, algorithm, limit, nowMs);

        const reply = await this.evalScript(handler.peekScript, args);
        return handler.parsePeekResult(reply, nowMs) ?? undefined;
    }

    /**
     * Delete the rate limit state for a single key from Redis.
     *
     * @param key - The rate limit key to delete. The configured {@link RedisStoreOptions.prefix | prefix} is prepended automatically.
     */
    async resetKey(key: string): Promise<void> {
        await this.sendCommand('DEL', this.prefix + key);
    }

    /**
     * Delete all rate limit keys matching the configured {@link RedisStoreOptions.prefix | prefix}.
     *
     * Uses `SCAN` to iterate keys incrementally, avoiding blocking Redis with a single `KEYS` call.
     */
    async resetAll(): Promise<void> {
        let cursor = '0';
        do {
            const reply = await this.sendCommand('SCAN', cursor, 'MATCH', this.prefix + '*', 'COUNT', '100');
            if (!Array.isArray(reply) || reply.length < 2 || !Array.isArray(reply[1])) {
                throw new Error(`Unexpected SCAN reply: ${String(reply)}`);
            }
            const [nextCursor, keys] = reply as [string, string[]];
            cursor = nextCursor;
            if (keys.length > 0) {
                await this.sendCommand('DEL', ...keys);
            }
        } while (cursor !== '0');
    }

    // ── Private ─────────────────────────────────────────────────────────────

    private getHandler(algorithmName: string): ScriptHandler {
        const handler = SCRIPT_REGISTRY.get(algorithmName);
        if (!handler) {
            throw new Error(`Unsupported algorithm: ${algorithmName}. RedisStore supports: ${[...SCRIPT_REGISTRY.keys()].join(', ')}`);
        }
        return handler;
    }

    /** Execute a Lua script with EVALSHA, falling back to EVAL on NOSCRIPT. */
    private async evalScript(script: string, args: string[]): Promise<RedisReply> {
        const [fullKey, ...scriptArgs] = args;
        const shaPromise = this.shaPromises.get(script) ?? this.loadScript(script);
        this.shaPromises.set(script, shaPromise);

        try {
            const sha = await shaPromise;
            return await this.sendCommand('EVALSHA', sha, '1', fullKey, ...scriptArgs);
        } catch (error: unknown) {
            if (isNoscriptError(error)) {
                const reply = await this.sendCommand('EVAL', script, '1', fullKey, ...scriptArgs);
                this.shaPromises.set(script, this.loadScript(script));
                return reply;
            }
            throw error;
        }
    }

    /** Load a Lua script into the Redis script cache and return its SHA1 hash. */
    private async loadScript(script: string): Promise<string> {
        const sha = await this.sendCommand('SCRIPT', 'LOAD', script);
        return String(sha);
    }
}

// ── Utilities ───────────────────────────────────────────────────────────────

/** Detect a Redis `NOSCRIPT` error, indicating the Lua script was evicted from cache. */
function isNoscriptError(error: unknown): boolean {
    if (error instanceof Error) {
        return error.message.includes('NOSCRIPT');
    }
    return String(error).includes('NOSCRIPT');
}
