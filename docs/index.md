---
layout: home

hero:
    name: universal-rate-limit
    tagline: Web-standards-based rate limiting with pluggable stores and framework middleware. Zero dependencies, works everywhere.
    actions:
        - theme: brand
          text: Get Started
          link: /getting-started
        - theme: alt
          text: API Reference
          link: /api
        - theme: alt
          text: GitHub
          link: https://github.com/KKonstantinov/universal-rate-limit

features:
    - title: Web Standards
      details: Built on Request/Response APIs — runs on Node.js, Bun, Deno, Cloudflare Workers, and Vercel Edge.
    - title: Pluggable Stores
      details: MemoryStore included. Implement the Store interface for Redis, KV, or any backend.
    - title: Framework Middleware
      details: Drop-in support for Express, Fastify, Hono, and Next.js with framework-native APIs.
    - title: Sliding Window
      details: Choose between fixed-window and sliding-window algorithms for smoother rate limiting.
    - title: IETF Headers
      details: Draft-6 and draft-7 rate limit headers with zero configuration, fully compliant.
    - title: Fully Typed
      details: Written in TypeScript with complete type definitions. Zero runtime dependencies.
---

## Quick Start

```bash
npm install universal-rate-limit
```

```ts
import { rateLimit } from 'universal-rate-limit';

const limiter = rateLimit({
    windowMs: 60_000, // 1 minute
    limit: 60 // 60 requests per window
});

const result = await limiter(request);

if (result.limited) {
    return new Response('Too Many Requests', {
        status: 429,
        headers: result.headers
    });
}
```

## Middleware

Rate limit any framework with a single line:

```ts
// Express
import { expressRateLimit } from '@universal-rate-limit/express';
app.use(expressRateLimit({ windowMs: 60_000, limit: 60 }));

// Hono
import { honoRateLimit } from '@universal-rate-limit/hono';
app.use(honoRateLimit({ windowMs: 60_000, limit: 60 }));
```

## Custom Stores

Bring your own storage backend:

```ts
import type { Store } from 'universal-rate-limit';

class RedisStore implements Store {
    async increment(key: string) {
        // Your Redis logic here
        return { totalHits: count, resetTime: new Date(reset) };
    }
    async decrement(key: string) {
        /* ... */
    }
    async resetKey(key: string) {
        /* ... */
    }
    async resetAll() {
        /* ... */
    }
}
```

## Packages

| Package                                                                                        | Description                |
| ---------------------------------------------------------------------------------------------- | -------------------------- |
| [`universal-rate-limit`](https://www.npmjs.com/package/universal-rate-limit)                   | Core rate limiting library |
| [`@universal-rate-limit/express`](https://www.npmjs.com/package/@universal-rate-limit/express) | Express middleware         |
| [`@universal-rate-limit/fastify`](https://www.npmjs.com/package/@universal-rate-limit/fastify) | Fastify plugin             |
| [`@universal-rate-limit/hono`](https://www.npmjs.com/package/@universal-rate-limit/hono)       | Hono middleware            |
| [`@universal-rate-limit/nextjs`](https://www.npmjs.com/package/@universal-rate-limit/nextjs)   | Next.js App Router wrapper |
