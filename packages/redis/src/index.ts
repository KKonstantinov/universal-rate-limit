import { INCREMENT_SCRIPT } from './scripts.js';

// ── Re-exports from core ────────────────────────────────────────────────────

export type { Store, IncrementResult } from 'universal-rate-limit';

// ── Types ───────────────────────────────────────────────────────────────────

export type RedisReply = string | number | null | RedisReply[];

export type SendCommandFn = (...args: string[]) => Promise<RedisReply>;

export interface RedisStoreOptions {
    /** User-provided function that sends a raw Redis command. */
    sendCommand: SendCommandFn;
    /** Window duration in milliseconds. */
    windowMs: number;
    /** Key prefix for all rate limit keys. @default 'rl:' */
    prefix?: string;
    /** Reset the TTL on every increment. @default false */
    resetExpiryOnChange?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseScriptResult(reply: RedisReply, windowMs: number): { totalHits: number; resetTime: Date } {
    const arr = reply as [number, number];
    const totalHits = arr[0];
    const timeToExpire = arr[1];
    const resetTime = new Date(Date.now() + (timeToExpire > 0 ? timeToExpire : windowMs));
    return { totalHits, resetTime };
}

// ── RedisStore ──────────────────────────────────────────────────────────────

export class RedisStore {
    private readonly sendCommand: SendCommandFn;
    private readonly windowMs: number;
    private readonly prefix: string;
    private readonly resetExpiryOnChange: boolean;

    private incrementShaPromise: Promise<string>;

    constructor(options: RedisStoreOptions) {
        this.sendCommand = options.sendCommand;
        this.windowMs = options.windowMs;
        this.prefix = options.prefix ?? 'rl:';
        this.resetExpiryOnChange = options.resetExpiryOnChange ?? false;

        // Eagerly load Lua script
        this.incrementShaPromise = this.loadScript(INCREMENT_SCRIPT);
    }

    async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
        const fullKey = this.prefix + key;
        const args = [fullKey, String(this.windowMs), this.resetExpiryOnChange ? '1' : '0'];

        try {
            const sha = await this.incrementShaPromise;
            const reply = await this.sendCommand('EVALSHA', sha, '1', ...args);
            return parseScriptResult(reply, this.windowMs);
        } catch (error: unknown) {
            if (isNoscriptError(error)) {
                // Script was evicted from cache — reload and retry once
                this.incrementShaPromise = this.loadScript(INCREMENT_SCRIPT);
                const sha = await this.incrementShaPromise;
                const reply = await this.sendCommand('EVALSHA', sha, '1', ...args);
                return parseScriptResult(reply, this.windowMs);
            }
            throw error;
        }
    }

    async decrement(key: string): Promise<void> {
        await this.sendCommand('DECR', this.prefix + key);
    }

    async resetKey(key: string): Promise<void> {
        await this.sendCommand('DEL', this.prefix + key);
    }

    async resetAll(): Promise<void> {
        let cursor = '0';
        do {
            const reply = (await this.sendCommand('SCAN', cursor, 'MATCH', this.prefix + '*', 'COUNT', '100')) as [string, string[]];
            cursor = reply[0];
            const keys = reply[1];
            if (keys.length > 0) {
                await this.sendCommand('DEL', ...keys);
            }
        } while (cursor !== '0');
    }

    // ── Private ─────────────────────────────────────────────────────────────

    private async loadScript(script: string): Promise<string> {
        const sha = await this.sendCommand('SCRIPT', 'LOAD', script);
        return String(sha);
    }
}

// ── Utilities ───────────────────────────────────────────────────────────────

function isNoscriptError(error: unknown): boolean {
    if (error instanceof Error) {
        return error.message.includes('NOSCRIPT');
    }
    return String(error).includes('NOSCRIPT');
}
