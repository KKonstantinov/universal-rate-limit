<p align="center">
  <img src="https://raw.githubusercontent.com/kkonstantinov/universal-rate-limit/main/packages/middleware/fastify/universal-rate-limit-fastify.png" alt="@universal-rate-limit/fastify" />
</p>

<h1 align="center">@universal-rate-limit/fastify</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@universal-rate-limit/fastify"><img src="https://img.shields.io/npm/v/@universal-rate-limit/fastify.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@universal-rate-limit/fastify"><img src="https://img.shields.io/npm/dm/@universal-rate-limit/fastify.svg" alt="npm downloads" /></a>
  <a href="https://www.npmjs.com/package/@universal-rate-limit/fastify"><img src="https://img.shields.io/npm/types/@universal-rate-limit/fastify.svg" alt="types" /></a>
  <a href="https://github.com/kkonstantinov/universal-rate-limit/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@universal-rate-limit/fastify.svg" alt="license" /></a>
</p>

Fastify plugin for [universal-rate-limit](https://www.npmjs.com/package/universal-rate-limit) — a zero-dependency rate limiter built on web standards. Supports fixed-window, sliding-window, and token-bucket algorithms, pluggable stores (memory, Redis, or your own), and
IETF-compliant rate limit headers out of the box.

> **[Try the playground](https://universal-rate-limit.vercel.app/playground)** to see rate limiting in action.

## Install

```bash
npm install @universal-rate-limit/fastify
```

## Usage

```ts
import Fastify from 'fastify';
import { fastifyRateLimit } from '@universal-rate-limit/fastify';

const fastify = Fastify();

await fastify.register(fastifyRateLimit, {
    algorithm: { type: 'sliding-window', windowMs: 60_000 }, // 1 minute
    limit: 60 // 60 requests per window
});

fastify.get('/', async () => {
    return { hello: 'world' };
});

await fastify.listen({ port: 3000 });
```

## Options

Accepts all [core options](https://www.npmjs.com/package/universal-rate-limit) — `limit`, `algorithm`, `cost`, `store`, `keyGenerator`, `skip`, `handler`, `message`, `statusCode`, `headers`, `legacyHeaders`, `failOpen`, and `prefix`.

## Example

See [`examples/fastify`](https://github.com/kkonstantinov/universal-rate-limit/tree/main/examples/fastify) for a complete working app with integration tests.

## Documentation

**[View the full documentation](https://universal-rate-limit.vercel.app/docs)**

## License

MIT
