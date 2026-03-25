# Stores

The rate limiter uses a pluggable store interface to track request counts. A `MemoryStore` is included by default, and you can implement the `Store` interface for any backend.

## Store Interface

```ts
interface ConsumeResult {
    limited: boolean;
    remaining: number;
    resetTime: Date;
    retryAfterMs: number;
}

interface Store {
    prefix?: string;
    consume(key: string, algorithm: Algorithm, limit: number, cost?: number): MaybePromise<ConsumeResult>;
    peek?(key: string, algorithm: Algorithm, limit: number): MaybePromise<ConsumeResult | undefined>;
    unconsume?(key: string, algorithm: Algorithm, limit: number, cost?: number): MaybePromise<void>;
    resetKey(key: string): MaybePromise<void>;
    resetAll(): MaybePromise<void>;
    shutdown?(): MaybePromise<void>;
}
```

### Methods

| Method                                                 | Description                                            |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `consume(key, algorithm, limit, cost?)`                | Consume capacity for `key`. Returns a `ConsumeResult`. |
| `peek(key, algorithm, limit)` _(optional)_             | Peek at current state without consuming.               |
| `unconsume(key, algorithm, limit, cost?)` _(optional)_ | Reverse a previous `consume` by restoring capacity.    |
| `resetKey(key)`                                        | Reset the counter for a single key.                    |
| `resetAll()`                                           | Clear all counters.                                    |
| `shutdown()` _(optional)_                              | Release resources (timers, connections).               |

## MemoryStore

The built-in `MemoryStore` is used by default. It uses an efficient dual-map approach for all supported algorithms (fixed-window, sliding-window, and token-bucket).

```ts
import { rateLimit, MemoryStore } from 'universal-rate-limit';

const limiter = rateLimit({
    algorithm: { type: 'fixed-window', windowMs: 60_000 },
    limit: 60,
    store: new MemoryStore({ cleanupIntervalMs: 30_000 })
});
```

### How It Works

- **Fixed window**: Counts hits in aligned time slots. Resets completely at each window boundary.
- **Sliding window**: Tracks both current and previous window hit counts. Weights the previous window's hits by how much of the current window has elapsed, providing smoother rate limiting.
- **Token bucket**: Tracks available tokens and refill timestamps. Tokens refill at a steady rate and are deducted per request.

The store runs a background cleanup timer (default: every 60 seconds, configurable via `cleanupIntervalMs`) to evict expired entries. The timer uses `.unref()` so it won't keep the process alive.

### Shutdown

Call `shutdown()` to clear the cleanup timer when you're done:

```ts
const store = new MemoryStore();
const limiter = rateLimit({ store });

// When shutting down:
store.shutdown();
```

## Redis Store

The `@universal-rate-limit/redis` package provides a production-ready Redis store. It is **client-agnostic** — you provide a `sendCommand` function that wraps your preferred Redis client.

```bash
npm install @universal-rate-limit/redis
```

### Usage with ioredis

```ts
import { rateLimit } from 'universal-rate-limit';
import { RedisStore } from '@universal-rate-limit/redis';
import Redis from 'ioredis';

const redis = new Redis();

const store = new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args)
});

const limiter = rateLimit({
    algorithm: { type: 'sliding-window', windowMs: 60_000 },
    limit: 100,
    store
});
```

### Usage with node-redis

```ts
import { createClient } from 'redis';
import { RedisStore } from '@universal-rate-limit/redis';

const client = createClient();
await client.connect();

const store = new RedisStore({
    sendCommand: (...args: string[]) => client.sendCommand(args)
});
```

### Options

| Option        | Type            | Default | Description                              |
| ------------- | --------------- | ------- | ---------------------------------------- |
| `sendCommand` | `SendCommandFn` | —       | **Required.** Sends a raw Redis command. |
| `prefix`      | `string`        | `'rl:'` | Key prefix for all rate limit keys.      |

### How It Works

- **Atomic operations** use Lua scripts (`EVALSHA`) so the hit count and TTL are always consistent.
- **NOSCRIPT recovery** — if the Redis script cache is flushed (e.g., after a restart), the store automatically reloads the script and retries.
- **Non-blocking `resetAll()`** uses `SCAN` + `DEL` instead of `KEYS` to avoid blocking Redis.
- **Zero Redis client dependencies** — works with ioredis, node-redis, or any client that can send raw commands.

## Custom Store

Implement the `Store` interface to use Durable Objects, KV, or any other backend:

```ts
import type { Store, ConsumeResult, Algorithm, MaybePromise } from 'universal-rate-limit';

class MyStore implements Store {
    async consume(key: string, algorithm: Algorithm, limit: number, cost?: number): Promise<ConsumeResult> {
        // Your implementation
        return { limited: false, remaining: limit - 1, resetTime: new Date(Date.now() + 60_000), retryAfterMs: 0 };
    }

    async resetKey(key: string): Promise<void> {
        // Your implementation
    }

    async resetAll(): Promise<void> {
        // Your implementation
    }
}
```

## Fail Open

If the store throws an error, the rate limiter will re-throw by default. Set `failOpen: true` to fail open — allowing the request through instead:

```ts
const limiter = rateLimit({
    store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
    failOpen: true // Allow requests if Redis is down
});
```
