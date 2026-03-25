<p align="center">
  <img src="universal-rate-limit-header.png" alt="universal-rate-limit" />
</p>

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

Rate limit any HTTP endpoint using the Web Standards `Request`/`Response` API — with built-in support for Express, Fastify, Hono, and Next.js. Swap between fixed-window and sliding-window algorithms, bring your own store, and get IETF-compliant rate limit headers out of the box.

<p align="center">
  <a href="https://kkonstantinov.github.io/universal-rate-limit/"><strong>Documentation</strong></a> · <a href="https://universal-rate-limit-playground.vercel.app"><strong>Playground</strong></a> · <a href="https://github.com/KKonstantinov/universal-rate-limit"><strong>GitHub</strong></a>
</p>

## Features

- **Web Standards** — built on `Request`/`Response`, runs on Node.js, Bun, Deno, and edge runtimes
- **Pluggable Stores** — MemoryStore included, implement the `Store` interface for Redis, KV, or any backend
- **Framework Middleware** — drop-in support for Express, Fastify, Hono, and Next.js
- **Sliding Window** — choose between fixed-window and sliding-window algorithms
- **IETF Headers** — draft-6 and draft-7 rate limit headers plus [`Retry-After`](https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3) with zero configuration
- **Fully Typed** — written in TypeScript with complete type definitions
- **Zero Dependencies** — the core package has no runtime dependencies
- **ESM Only** — modern, tree-shakeable

## Install

```bash
# Core library
npm install universal-rate-limit

# Middleware (install only what you need)
npm install @universal-rate-limit/express
npm install @universal-rate-limit/fastify
npm install @universal-rate-limit/hono
npm install @universal-rate-limit/nextjs
```

## Quick Start

```ts
import { rateLimit } from 'universal-rate-limit';

const limiter = rateLimit({
    windowMs: 60_000, // 1 minute
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

## Middleware

Each framework adapter is a separate package that wraps the core limiter:

```ts
// Express
import { expressRateLimit } from '@universal-rate-limit/express';
app.use(expressRateLimit({ windowMs: 60_000, limit: 60 }));

// Fastify
import { fastifyRateLimit } from '@universal-rate-limit/fastify';
fastify.register(fastifyRateLimit, { windowMs: 60_000, limit: 60 });

// Hono
import { honoRateLimit } from '@universal-rate-limit/hono';
app.use(honoRateLimit({ windowMs: 60_000, limit: 60 }));

// Next.js (App Router)
import { withRateLimit } from '@universal-rate-limit/nextjs';
export const GET = withRateLimit(handler, { windowMs: 60_000, limit: 60 });
```

## Options

All options are optional. Defaults are shown below:

```ts
rateLimit({
    windowMs: 60_000, // Time window in milliseconds (default: 1 minute)
    limit: 60, // Max requests per window (number or async function)
    algorithm: 'fixed-window', // 'fixed-window' or 'sliding-window'
    headers: 'draft-7', // 'draft-7' or 'draft-6'
    store: new MemoryStore(), // Custom store implementation
    keyGenerator: req => ip, // Extract client identifier from request
    skip: req => false, // Skip rate limiting for certain requests
    handler: undefined, // Custom 429 response handler
    message: 'Too Many Requests', // Response body (string, object, or function)
    statusCode: 429, // HTTP status code when limited
    failOpen: false // Fail open if store errors
});
```

## Store Interface

Implement the `Store` interface to use any backend:

```ts
import type { Store, IncrementResult } from 'universal-rate-limit';

class RedisStore implements Store {
    async increment(key: string): Promise<IncrementResult> {
        // Increment counter and return { totalHits, resetTime }
    }
    async decrement(key: string): Promise<void> {
        /* ... */
    }
    async resetKey(key: string): Promise<void> {
        /* ... */
    }
    async resetAll(): Promise<void> {
        /* ... */
    }
}

const limiter = rateLimit({ store: new RedisStore() });
```

## Examples

Example apps with integration tests for each framework:

| Example                                | Framework | Description                          |
| -------------------------------------- | --------- | ------------------------------------ |
| [`examples/express`](examples/express) | Express   | Rate-limited Express API server      |
| [`examples/fastify`](examples/fastify) | Fastify   | Rate-limited Fastify API server      |
| [`examples/hono`](examples/hono)       | Hono      | Rate-limited Hono API server         |
| [`examples/nextjs`](examples/nextjs)   | Next.js   | Rate-limited Next.js App Router APIs |

## Packages

This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces):

| Package                                                        | Description                                    |
| -------------------------------------------------------------- | ---------------------------------------------- |
| [`universal-rate-limit`](packages/core)                        | Core rate limiting library                     |
| [`@universal-rate-limit/express`](packages/middleware/express) | Express middleware                             |
| [`@universal-rate-limit/fastify`](packages/middleware/fastify) | Fastify plugin                                 |
| [`@universal-rate-limit/hono`](packages/middleware/hono)       | Hono middleware                                |
| [`@universal-rate-limit/nextjs`](packages/middleware/nextjs)   | Next.js App Router wrapper and Edge middleware |

## Documentation

**[View the full documentation](https://kkonstantinov.github.io/universal-rate-limit/)**

- [Getting Started](docs/getting-started.md) — installation, first limiter, common patterns
- [Middleware](docs/middleware.md) — Express, Fastify, Hono, and Next.js adapters
- [Stores](docs/stores.md) — Store interface and custom implementations
- [API Reference](docs/api.md) — complete API documentation with all types
- [Contributing](CONTRIBUTING.md) — development setup, testing, and contributing guidelines

## Runtime Compatibility

| Runtime            | Version | Status     |
| ------------------ | ------- | ---------- |
| Node.js            | >= 20   | Tested     |
| Bun                | >= 1.0  | Tested     |
| Deno               | >= 2.0  | Tested     |
| Cloudflare Workers | -       | Compatible |
| Vercel Edge        | -       | Compatible |

## Acknowledgements

Inspired by [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) — the most popular rate limiting middleware for Express.js. `universal-rate-limit` builds on its proven API design while extending it to work across frameworks and runtimes with Web
Standard APIs.

## License

MIT
