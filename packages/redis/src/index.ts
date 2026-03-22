import type { Store, IncrementResult } from 'universal-rate-limit';
import { GET_SCRIPT, INCREMENT_SCRIPT } from './scripts.js';

// ── Re-exports from core ────────────────────────────────────────────────────

export type { Store, IncrementResult } from 'universal-rate-limit';

// ── Types ───────────────────────────────────────────────────────────────────

/** A value that can be returned from a raw Redis command. */
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
    /** Duration of the rate limit window in milliseconds. */
    windowMs: number;
    /** Key prefix prepended to every rate limit key in Redis. @default 'rl:' */
    prefix?: string;
    /** When `true`, the key TTL is refreshed on every increment. @default false */
    resetExpiryOnChange?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse the two-element `[totalHits, timeToExpire]` array returned by the
 * Redis Lua scripts into a typed {@link IncrementResult}.
 *
 * Redis stores use a single counter per key, so `currentHits` is the total
 * and `previousHits` is always `0`. The algorithm strategy in the core
 * library handles any windowing logic on top of these raw values.
 */
function parseScriptResult(reply: RedisReply, windowMs: number): IncrementResult {
    if (!Array.isArray(reply) || reply.length < 2) {
        throw new Error(`Unexpected Redis script reply: ${String(reply)}`);
    }
    const currentHits = Number(reply[0]);
    const timeToExpire = Number(reply[1]);
    if (!Number.isFinite(currentHits) || !Number.isFinite(timeToExpire)) {
        throw new TypeError(`Non-numeric values in Redis script reply: ${String(reply)}`);
    }
    const resetTime = new Date(Date.now() + (timeToExpire > 0 ? timeToExpire : windowMs));
    return { currentHits, previousHits: 0, resetTime };
}

function parseGetResult(reply: RedisReply, windowMs: number): IncrementResult | null {
    if (!Array.isArray(reply) || reply.length < 2) {
        throw new Error(`Unexpected Redis GET script reply: ${String(reply)}`);
    }
    const currentHits = Number(reply[0]);
    const ttl = Number(reply[1]);
    if (currentHits === -1) return null;
    if (!Number.isFinite(currentHits) || !Number.isFinite(ttl)) {
        throw new TypeError(`Non-numeric values in Redis GET script reply: ${String(reply)}`);
    }
    const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : windowMs));
    return { currentHits, previousHits: 0, resetTime };
}

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
 *   windowMs: 60_000,
 * });
 * ```
 */
export class RedisStore implements Store {
    private readonly sendCommand: SendCommandFn;
    private readonly windowMs: number;
    readonly prefix: string;
    private readonly resetExpiryOnChange: boolean;

    private incrementShaPromise: Promise<string> | undefined;
    private getShaPromise: Promise<string> | undefined;

    /** @param options - Redis store configuration. */
    constructor(options: RedisStoreOptions) {
        this.sendCommand = options.sendCommand;
        this.windowMs = options.windowMs;
        this.prefix = options.prefix ?? 'rl:';
        this.resetExpiryOnChange = options.resetExpiryOnChange ?? false;
    }

    /** Fetch the current hit count and TTL for `key` without incrementing. */
    async get(key: string): Promise<IncrementResult | undefined> {
        const fullKey = this.prefix + key;
        this.getShaPromise ??= this.loadScript(GET_SCRIPT);

        try {
            const sha = await this.getShaPromise;
            const reply = await this.sendCommand('EVALSHA', sha, '1', fullKey);
            return parseGetResult(reply, this.windowMs) ?? undefined;
        } catch (error: unknown) {
            if (isNoscriptError(error)) {
                const reply = await this.sendCommand('EVAL', GET_SCRIPT, '1', fullKey);
                this.getShaPromise = this.loadScript(GET_SCRIPT);
                return parseGetResult(reply, this.windowMs) ?? undefined;
            }
            throw error;
        }
    }

    /**
     * Atomically increment the hit counter for `key` using a Lua script.
     * If the key does not exist, it is created with a TTL of {@link RedisStoreOptions.windowMs}.
     */
    async increment(key: string): Promise<IncrementResult> {
        const fullKey = this.prefix + key;
        const args = [fullKey, String(this.windowMs), this.resetExpiryOnChange ? '1' : '0'];
        this.incrementShaPromise ??= this.loadScript(INCREMENT_SCRIPT);

        try {
            const sha = await this.incrementShaPromise;
            const reply = await this.sendCommand('EVALSHA', sha, '1', ...args);
            return parseScriptResult(reply, this.windowMs);
        } catch (error: unknown) {
            if (isNoscriptError(error)) {
                const reply = await this.sendCommand('EVAL', INCREMENT_SCRIPT, '1', ...args);
                this.incrementShaPromise = this.loadScript(INCREMENT_SCRIPT);
                return parseScriptResult(reply, this.windowMs);
            }
            throw error;
        }
    }

    /** Decrement the counter for `key` by one. */
    async decrement(key: string): Promise<void> {
        await this.sendCommand('DECR', this.prefix + key);
    }

    /** Delete the rate limit key from Redis. */
    async resetKey(key: string): Promise<void> {
        await this.sendCommand('DEL', this.prefix + key);
    }

    /** Scan and delete all keys matching the configured prefix. */
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
