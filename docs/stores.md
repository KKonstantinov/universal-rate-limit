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
    sendCommand: (...args: string[]) => redis.call(...args),
    windowMs: 60_000
});

const limiter = rateLimit({
    windowMs: 60_000,
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
    sendCommand: (...args: string[]) => client.sendCommand(args),
    windowMs: 60_000
});
```

### Options

| Option        | Type            | Default | Description                              |
| ------------- | --------------- | ------- | ---------------------------------------- |
| `sendCommand` | `SendCommandFn` | —       | **Required.** Sends a raw Redis command. |
| `prefix`      | `string`        | `'rl:'` | Key prefix for all rate limit keys.      |

### How It Works

- **Atomic increments** use Lua scripts (`EVALSHA`) so the hit count and TTL are always consistent.
- **NOSCRIPT recovery** — if the Redis script cache is flushed (e.g., after a restart), the store automatically reloads the script and retries.
- **Non-blocking `resetAll()`** uses `SCAN` + `DEL` instead of `KEYS` to avoid blocking Redis.
- **Zero Redis client dependencies** — works with ioredis, node-redis, or any client that can send raw commands.

## Custom Store

Implement the `Store` interface to use Durable Objects, KV, or any other backend:

```ts
import type { Store, IncrementResult } from 'universal-rate-limit';

class MyStore implements Store {
    async increment(key: string): Promise<IncrementResult> {
        // Your implementation
        return { totalHits: 1, resetTime: new Date(Date.now() + 60_000) };
    }

    async decrement(key: string): Promise<void> {
        // Your implementation
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

If the store throws an error, the rate limiter will re-throw by default. Set `passOnStoreError: true` to fail open — allowing the request through instead:

```ts
const limiter = rateLimit({
    store: new RedisStore(redis, 60_000),
    passOnStoreError: true // Allow requests if Redis is down
});
```
