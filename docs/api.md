# API Reference

## `rateLimit(options?)`

Creates a rate limiter function.

```ts
import { rateLimit } from 'universal-rate-limit';

const limiter = rateLimit(options);
const result: RateLimitResult = await limiter(request);
```

**Parameters:**

| Option             | Type                                                                                      | Default                | Description                 |
| ------------------ | ----------------------------------------------------------------------------------------- | ---------------------- | --------------------------- |
| `windowMs`         | `number`                                                                                  | `60_000`               | Time window in milliseconds |
| `limit`            | `number \| (req: Request) => number \| Promise<number>`                                   | `60`                   | Maximum requests per window |
| `algorithm`        | `'fixed-window' \| 'sliding-window'`                                                      | `'fixed-window'`       | Rate limiting algorithm     |
| `headers`          | `'draft-7' \| 'draft-6'`                                                                  | `'draft-7'`            | IETF headers version        |
| `store`            | `Store`                                                                                   | `new MemoryStore(...)` | Storage backend             |
| `keyGenerator`     | `(req: Request) => string \| Promise<string>`                                             | IP-based               | Extract client identifier   |
| `skip`             | `(req: Request) => boolean \| Promise<boolean>`                                           | `undefined`            | Skip rate limiting          |
| `handler`          | `(req: Request, result: RateLimitResult) => Response \| Promise<Response>`                | `undefined`            | Custom response handler     |
| `message`          | `string \| Record<string, unknown> \| (req, result) => string \| Record<string, unknown>` | `'Too Many Requests'`  | Response body               |
| `statusCode`       | `number`                                                                                  | `429`                  | HTTP status code            |
| `passOnStoreError` | `boolean`                                                                                 | `false`                | Fail open on store errors   |

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

const store = new MemoryStore(windowMs, algorithm);
```

**Constructor:**

| Parameter   | Type                                 | Description                     |
| ----------- | ------------------------------------ | ------------------------------- |
| `windowMs`  | `number`                             | Window duration in milliseconds |
| `algorithm` | `'fixed-window' \| 'sliding-window'` | Algorithm to use                |

**Methods:**

| Method           | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `increment(key)` | Increment counter, returns `Promise<IncrementResult>` |
| `decrement(key)` | Decrement counter                                     |
| `resetKey(key)`  | Reset a single key                                    |
| `resetAll()`     | Clear all entries                                     |
| `shutdown()`     | Stop the cleanup timer                                |

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

| Method           | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `increment(key)` | Increment counter, returns `Promise<IncrementResult>` |
| `decrement(key)` | Decrement counter                                     |
| `resetKey(key)`  | Reset a single key                                    |
| `resetAll()`     | Clear all prefixed keys via `SCAN` + `DEL`            |

---

## `Store` Interface

Implement this interface for custom storage backends.

```ts
interface Store {
    increment(key: string): Promise<IncrementResult>;
    decrement(key: string): Promise<void>;
    resetKey(key: string): Promise<void>;
    resetAll(): Promise<void>;
}

interface IncrementResult {
    totalHits: number;
    resetTime: Date;
}
```

---

## Types

```ts
type Algorithm = 'fixed-window' | 'sliding-window';
type HeadersVersion = 'draft-6' | 'draft-7';
```

---

## Store Exports

### `@universal-rate-limit/redis`

```ts
import { RedisStore } from '@universal-rate-limit/redis';
```

`RedisStore` — Client-agnostic Redis store. Also re-exports `Store` and `IncrementResult` from core.

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

All middleware packages also re-export: `RateLimitOptions`, `RateLimitResult`, `Store`, `IncrementResult`, `MemoryStore`.
