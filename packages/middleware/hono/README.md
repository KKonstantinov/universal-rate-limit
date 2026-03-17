# @universal-rate-limit/hono

[![npm version](https://img.shields.io/npm/v/@universal-rate-limit/hono.svg)](https://www.npmjs.com/package/@universal-rate-limit/hono) [![npm downloads](https://img.shields.io/npm/dm/@universal-rate-limit/hono.svg)](https://www.npmjs.com/package/@universal-rate-limit/hono)
[![types](https://img.shields.io/npm/types/@universal-rate-limit/hono.svg)](https://www.npmjs.com/package/@universal-rate-limit/hono) [![license](https://img.shields.io/npm/l/@universal-rate-limit/hono.svg)](https://github.com/kkonstantinov/universal-rate-limit/blob/main/LICENSE)

Hono middleware for [universal-rate-limit](https://www.npmjs.com/package/universal-rate-limit) — a zero-dependency rate limiter built on web standards. Supports fixed-window and sliding-window algorithms, pluggable stores (memory, Redis, or your own), and IETF-compliant rate
limit headers out of the box. Works on Node.js, Bun, Deno, Cloudflare Workers, and other edge runtimes.

## Install

```bash
npm install @universal-rate-limit/hono
```

## Usage

```ts
import { Hono } from 'hono';
import { honoRateLimit } from '@universal-rate-limit/hono';

const app = new Hono();

// Apply to all routes
app.use(
    honoRateLimit({
        windowMs: 60_000, // 1 minute
        limit: 60 // 60 requests per window
    })
);

// Or apply to specific routes
app.use(
    '/api/*',
    honoRateLimit({
        windowMs: 60_000,
        limit: 30
    })
);

export default app;
```

## Options

Accepts all [core options](https://www.npmjs.com/package/universal-rate-limit) — `windowMs`, `limit`, `algorithm`, `store`, `keyGenerator`, `skip`, `handler`, `message`, `statusCode`, `headers`, and `passOnStoreError`.

## Example

See [`examples/hono`](https://github.com/kkonstantinov/universal-rate-limit/tree/main/examples/hono) for a complete working app with integration tests.

## Documentation

**[View the full documentation](https://kkonstantinov.github.io/universal-rate-limit/)**

## License

MIT
