# Stores

The rate limiter uses a pluggable store interface to track request counts. A `MemoryStore` is included by default, and you can implement the `Store` interface for any backend.

## Store Interface

```ts
interface IncrementResult {
    totalHits: number;
    resetTime: Date;
}

interface Store {
    increment(key: string): Promise<IncrementResult>;
    decrement(key: string): Promise<void>;
    resetKey(key: string): Promise<void>;
    resetAll(): Promise<void>;
}
```

### Methods

| Method           | Description                                                               |
| ---------------- | ------------------------------------------------------------------------- |
| `increment(key)` | Increment the hit counter for `key`. Returns `totalHits` and `resetTime`. |
| `decrement(key)` | Decrement the hit counter (e.g., after a successful skip).                |
| `resetKey(key)`  | Reset the counter for a single key.                                       |
| `resetAll()`     | Clear all counters.                                                       |

## MemoryStore

The built-in `MemoryStore` is used by default. It uses an efficient dual-map approach for both fixed-window and sliding-window algorithms.

```ts
import { rateLimit, MemoryStore } from 'universal-rate-limit';

const limiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    store: new MemoryStore(60_000, 'fixed-window')
});
```

### How It Works

- **Fixed window**: Counts hits in aligned time slots. Resets completely at each window boundary.
- **Sliding window**: Maintains both a `current` and `previous` window map. Weights the previous window's hits by how much of the window has elapsed, providing smoother rate limiting.

The store runs a cleanup timer every `windowMs` to remove expired entries. The timer uses `.unref()` so it won't keep the process alive.

### Shutdown

Call `shutdown()` to clear the cleanup timer when you're done:

```ts
const store = new MemoryStore(60_000, 'fixed-window');
const limiter = rateLimit({ store });

// When shutting down:
store.shutdown();
```

## Custom Store

Implement the `Store` interface to use Redis, Durable Objects, KV, or any other backend:

```ts
import type { Store, IncrementResult } from 'universal-rate-limit';

class RedisStore implements Store {
    private redis: RedisClient;
    private windowMs: number;

    constructor(redis: RedisClient, windowMs: number) {
        this.redis = redis;
        this.windowMs = windowMs;
    }

    async increment(key: string): Promise<IncrementResult> {
        const totalHits = await this.redis.incr(`rl:${key}`);
        if (totalHits === 1) {
            await this.redis.pexpire(`rl:${key}`, this.windowMs);
        }
        const ttl = await this.redis.pttl(`rl:${key}`);
        const resetTime = new Date(Date.now() + ttl);
        return { totalHits, resetTime };
    }

    async decrement(key: string): Promise<void> {
        await this.redis.decr(`rl:${key}`);
    }

    async resetKey(key: string): Promise<void> {
        await this.redis.del(`rl:${key}`);
    }

    async resetAll(): Promise<void> {
        const keys = await this.redis.keys('rl:*');
        if (keys.length > 0) {
            await this.redis.del(...keys);
        }
    }
}

// Usage
const limiter = rateLimit({
    store: new RedisStore(redis, 60_000),
    windowMs: 60_000,
    limit: 100
});
```

## Fail Open

If the store throws an error, the rate limiter will re-throw by default. Set `passOnStoreError: true` to fail open — allowing the request through instead:

```ts
const limiter = rateLimit({
    store: new RedisStore(redis, 60_000),
    passOnStoreError: true // Allow requests if Redis is down
});
```
