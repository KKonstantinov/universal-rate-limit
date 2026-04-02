<p align="center">
  <img src="https://raw.githubusercontent.com/kkonstantinov/universal-rate-limit/main/universal-rate-limit-header.png" alt="universal-rate-limit" />
</p>

<h1 align="center">universal-rate-limit</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/universal-rate-limit"><img src="https://img.shields.io/npm/v/universal-rate-limit.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/universal-rate-limit"><img src="https://img.shields.io/npm/dm/universal-rate-limit.svg" alt="npm downloads" /></a>
  <a href="https://www.npmjs.com/package/universal-rate-limit"><img src="https://img.shields.io/npm/types/universal-rate-limit.svg" alt="types" /></a>
  <a href="https://github.com/kkonstantinov/universal-rate-limit/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/universal-rate-limit.svg" alt="license" /></a>
</p>

<p align="center">
  Web-standards-based rate limiting with pluggable stores and framework middleware.<br>
  Zero dependencies. Works everywhere.
</p>

---

**[Try it in the playground](https://universal-rate-limit.vercel.app/playground)** — configure limits, fire requests, and see rate limiting in action.

## Why universal-rate-limit?

Most rate limiters are tied to a single framework or runtime. `universal-rate-limit` is built on the Web Standards `Request`/`Response` API, so the same core works on Node.js, Bun, Deno, Cloudflare Workers, and Vercel Edge — no rewrites, no adapters to learn from scratch.

- **One library, every runtime** — write your rate limiting logic once, deploy it anywhere
- **Drop-in framework middleware** — first-class adapters for Express, Fastify, Hono, and Next.js
- **IETF-compliant headers** — draft-6 and draft-7 rate limit headers plus [`Retry-After`](https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3) out of the box
- **~3 KB min+gzip** — zero dependencies, tree-shakeable ESM

## Install

```bash
npm install universal-rate-limit
```

## Quick Start

```ts
import { rateLimit } from 'universal-rate-limit';

const limiter = rateLimit({
    algorithm: { type: 'sliding-window', windowMs: 60_000 }, // 1 minute
    limit: 60 // 60 requests per window
});

// Use with any Web Standard Request
const result = await limiter(request);

if (result.limited) {
    return new Response('Too Many Requests', {
        status: 429,
        headers: result.headers
    });
}
```

## Options

All options are optional. Defaults are shown below:

```ts
rateLimit({
    limit: 60, // Max requests per window (number or async function)
    algorithm: slidingWindow({ windowMs: 60_000 }), // Algorithm instance or config object
    cost: 1, // Units to consume per request (number or async function)
    headers: 'draft-7', // 'draft-7' or 'draft-6'
    legacyHeaders: false, // Include X-RateLimit-* headers
    store: new MemoryStore(), // Custom store implementation
    keyGenerator: req => ip, // Extract client identifier from request
    skip: req => false, // Skip rate limiting for certain requests
    handler: undefined, // Custom 429 response handler
    message: 'Too Many Requests', // Response body (string, object, or function)
    statusCode: 429, // HTTP status code when limited
    failOpen: false, // Fail open if store errors
    prefix: undefined // Namespace prefix for multiple limiters on one store
});
```

## Store Interface

Implement the `Store` interface to use any backend:

```ts
import type { Store, ConsumeResult, Algorithm } from 'universal-rate-limit';

class MyStore implements Store {
    async consume(key: string, algorithm: Algorithm, limit: number, cost?: number): Promise<ConsumeResult> {
        // Consume capacity and return { limited, remaining, resetTime, retryAfterMs }
    }
    async resetKey(key: string): Promise<void> {
        /* ... */
    }
    async resetAll(): Promise<void> {
        /* ... */
    }
}

const limiter = rateLimit({ store: new MyStore() });
```

A ready-made Redis store is available via [`@universal-rate-limit/redis`](https://www.npmjs.com/package/@universal-rate-limit/redis).

## Examples

Example apps with integration tests are available for each framework:

- [Express](https://github.com/kkonstantinov/universal-rate-limit/tree/main/examples/express)
- [Fastify](https://github.com/kkonstantinov/universal-rate-limit/tree/main/examples/fastify)
- [Hono](https://github.com/kkonstantinov/universal-rate-limit/tree/main/examples/hono)
- [Next.js](https://github.com/kkonstantinov/universal-rate-limit/tree/main/examples/nextjs)

## Framework Middleware

Drop-in adapters are available as separate packages:

| Package                                                                                        | Framework          | Install                               |
| ---------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------- |
| [`@universal-rate-limit/express`](https://www.npmjs.com/package/@universal-rate-limit/express) | Express            | `npm i @universal-rate-limit/express` |
| [`@universal-rate-limit/fastify`](https://www.npmjs.com/package/@universal-rate-limit/fastify) | Fastify            | `npm i @universal-rate-limit/fastify` |
| [`@universal-rate-limit/hono`](https://www.npmjs.com/package/@universal-rate-limit/hono)       | Hono               | `npm i @universal-rate-limit/hono`    |
| [`@universal-rate-limit/nextjs`](https://www.npmjs.com/package/@universal-rate-limit/nextjs)   | Next.js App Router | `npm i @universal-rate-limit/nextjs`  |

## Runtime Compatibility

| Runtime            | Version | Status     |
| ------------------ | ------- | ---------- |
| Node.js            | >= 20   | Tested     |
| Bun                | >= 1.0  | Tested     |
| Deno               | >= 2.0  | Tested     |
| Cloudflare Workers | -       | Compatible |
| Vercel Edge        | -       | Compatible |

## Documentation

**[View the full documentation](https://universal-rate-limit.vercel.app/docs)**

## License

MIT
