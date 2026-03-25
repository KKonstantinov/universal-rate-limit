# API Reference

## `rateLimit(options?)`

Creates a rate limiter function.

```ts
import { rateLimit } from 'universal-rate-limit';

const limiter = rateLimit(options);
const result: RateLimitResult = await limiter(request);
```

**Parameters:**

| Option          | Type                                                                                      | Default                | Description                    |
| --------------- | ----------------------------------------------------------------------------------------- | ---------------------- | ------------------------------ |
| `limit`         | `number \| (req: Request) => number \| Promise<number>`                                   | `60`                   | Maximum requests per window    |
| `algorithm`     | `AlgorithmConfig \| Algorithm`                                                            | sliding-window (60s)   | Rate limiting algorithm        |
| `cost`          | `number \| (req: Request) => number \| Promise<number>`                                   | `1`                    | Units to consume per request   |
| `headers`       | `'draft-7' \| 'draft-6'`                                                                  | `'draft-7'`            | IETF headers version           |
| `legacyHeaders` | `boolean`                                                                                 | `false`                | Include X-RateLimit-\* headers |
| `store`         | `Store`                                                                                   | `new MemoryStore(...)` | Storage backend                |
| `keyGenerator`  | `(req: Request) => string \| Promise<string>`                                             | IP-based               | Extract client identifier      |
| `skip`          | `(req: Request) => boolean \| Promise<boolean>`                                           | `undefined`            | Skip rate limiting             |
| `handler`       | `(req: Request, result: RateLimitResult) => Response \| Promise<Response>`                | `undefined`            | Custom response handler        |
| `message`       | `string \| Record<string, unknown> \| (req, result) => string \| Record<string, unknown>` | `'Too Many Requests'`  | Response body                  |
| `statusCode`    | `number`                                                                                  | `429`                  | HTTP status code               |
| `failOpen`      | `boolean`                                                                                 | `false`                | Fail open on store errors      |

**Returns:** `(request: Request) => Promise<RateLimitResult>`

---

## `RateLimitResult`

The result object returned by the limiter function.

```ts
interface RateLimitResult {
    limited: boolean;
    limit: number;
    remaining: number;
    resetTime: Date;
    headers: Record<string, string>;
}
```

| Field       | Type                     | Description                                                                                                                                               |
| ----------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limited`   | `boolean`                | Whether the request is rate limited                                                                                                                       |
| `limit`     | `number`                 | Maximum requests allowed in the window                                                                                                                    |
| `remaining` | `number`                 | Requests remaining in the current window                                                                                                                  |
| `resetTime` | `Date`                   | When the current window resets                                                                                                                            |
| `headers`   | `Record<string, string>` | IETF rate limit headers to set on the response. Includes [`Retry-After`](https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3) when `limited` is `true`. |

---

## `buildRateLimitResponse(request, result, options)`

Helper used by middleware adapters to build a 429 response.

```ts
import { buildRateLimitResponse } from 'universal-rate-limit';

const response = await buildRateLimitResponse(request, result, {
    handler: undefined,
    message: 'Too Many Requests',
    statusCode: 429
});
```

**Parameters:**

| Parameter            | Type                           | Description                              |
| -------------------- | ------------------------------ | ---------------------------------------- |
| `request`            | `Request`                      | The original request                     |
| `result`             | `RateLimitResult`              | The rate limit result                    |
| `options.handler`    | `(req, result) => Response`    | Custom response handler (takes priority) |
| `options.message`    | `string \| object \| function` | Response body                            |
| `options.statusCode` | `number`                       | HTTP status code                         |

**Returns:** `Promise<Response>`

---

## `MemoryStore`

In-memory store implementation with dual-map design for efficient sliding-window support.

```ts
import { MemoryStore } from 'universal-rate-limit';

const store = new MemoryStore({ prefix: 'my-app:', cleanupIntervalMs: 30_000 });
```

**Constructor:**

| Parameter                   | Type     | Default     | Description                 |
| --------------------------- | -------- | ----------- | --------------------------- |
| `options.prefix`            | `string` | `undefined` | Key prefix                  |
| `options.cleanupIntervalMs` | `number` | `60_000`    | Background cleanup interval |

**Methods:**

| Method                                    | Description                               |
| ----------------------------------------- | ----------------------------------------- |
| `consume(key, algorithm, limit, cost?)`   | Consume capacity, returns `ConsumeResult` |
| `peek(key, algorithm, limit)`             | Peek without consuming                    |
| `unconsume(key, algorithm, limit, cost?)` | Restore consumed capacity                 |
| `resetKey(key)`                           | Reset a single key                        |
| `resetAll()`                              | Clear all entries                         |
| `shutdown()`                              | Stop the cleanup timer                    |

---

## `RedisStore`

Redis-backed store from `@universal-rate-limit/redis`. Uses Lua scripts for atomic operations.

```ts
import { RedisStore } from '@universal-rate-limit/redis';

const store = new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rl:'
});
```

**Constructor:**

| Parameter     | Type            | Default | Description                              |
| ------------- | --------------- | ------- | ---------------------------------------- |
| `sendCommand` | `SendCommandFn` | —       | **Required.** Sends a raw Redis command. |
| `prefix`      | `string`        | `'rl:'` | Key prefix for all rate limit keys.      |

**Methods:**

| Method                                  | Description                                        |
| --------------------------------------- | -------------------------------------------------- |
| `consume(key, algorithm, limit, cost?)` | Consume capacity, returns `Promise<ConsumeResult>` |
| `peek(key, algorithm, limit)`           | Peek without consuming                             |
| `resetKey(key)`                         | Reset a single key                                 |
| `resetAll()`                            | Clear all prefixed keys via `SCAN` + `DEL`         |

---

## `Store` Interface

Implement this interface for custom storage backends.

```ts
interface Store {
    prefix?: string;
    consume(key: string, algorithm: Algorithm, limit: number, cost?: number): MaybePromise<ConsumeResult>;
    peek?(key: string, algorithm: Algorithm, limit: number): MaybePromise<ConsumeResult | undefined>;
    unconsume?(key: string, algorithm: Algorithm, limit: number, cost?: number): MaybePromise<void>;
    resetKey(key: string): MaybePromise<void>;
    resetAll(): MaybePromise<void>;
    shutdown?(): MaybePromise<void>;
}

interface ConsumeResult {
    limited: boolean;
    remaining: number;
    resetTime: Date;
    retryAfterMs: number;
}
```

---

## Types

```ts
type AlgorithmConfig = { type: 'fixed-window'; windowMs: number } | { type: 'sliding-window'; windowMs: number } | { type: 'token-bucket'; refillRate: number; bucketSize?: number; refillMs?: number };

type HeadersVersion = 'draft-6' | 'draft-7';
```

---

## Store Exports

### `@universal-rate-limit/redis`

```ts
import { RedisStore } from '@universal-rate-limit/redis';
```

`RedisStore` — Client-agnostic Redis store. Also re-exports `Store` and `ConsumeResult` from core.

---

## Middleware Exports

### `@universal-rate-limit/express`

```ts
import { expressRateLimit } from '@universal-rate-limit/express';
```

`expressRateLimit(options?)` — Returns an Express `RequestHandler`.

### `@universal-rate-limit/fastify`

```ts
import { fastifyRateLimit } from '@universal-rate-limit/fastify';
```

`fastifyRateLimit` — Fastify plugin. Register with `fastify.register(fastifyRateLimit, options)`.

### `@universal-rate-limit/hono`

```ts
import { honoRateLimit } from '@universal-rate-limit/hono';
```

`honoRateLimit(options?)` — Returns a Hono `MiddlewareHandler`.

### `@universal-rate-limit/nextjs`

```ts
import { withRateLimit, nextjsRateLimit } from '@universal-rate-limit/nextjs';
```

- `withRateLimit(handler, options?)` — Wraps a Next.js App Router handler with rate limiting.
- `nextjsRateLimit(options?)` — Creates a limiter for Edge Middleware use.

All middleware packages also re-export: `RateLimitOptions`, `RateLimitResult`, `Store`, `ConsumeResult`, `MemoryStore`.
