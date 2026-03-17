# @universal-rate-limit/fastify

[![npm version](https://img.shields.io/npm/v/@universal-rate-limit/fastify.svg)](https://www.npmjs.com/package/@universal-rate-limit/fastify)
[![npm downloads](https://img.shields.io/npm/dm/@universal-rate-limit/fastify.svg)](https://www.npmjs.com/package/@universal-rate-limit/fastify)
[![types](https://img.shields.io/npm/types/@universal-rate-limit/fastify.svg)](https://www.npmjs.com/package/@universal-rate-limit/fastify)
[![license](https://img.shields.io/npm/l/@universal-rate-limit/fastify.svg)](https://github.com/kkonstantinov/universal-rate-limit/blob/main/LICENSE)

Fastify plugin for [universal-rate-limit](https://www.npmjs.com/package/universal-rate-limit) — a zero-dependency rate limiter built on web standards. Supports fixed-window and sliding-window algorithms, pluggable stores (memory, Redis, or your own), and IETF-compliant rate limit
headers out of the box.

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
    windowMs: 60_000, // 1 minute
    limit: 60 // 60 requests per window
});

fastify.get('/', async () => {
    return { hello: 'world' };
});

await fastify.listen({ port: 3000 });
```

## Options

Accepts all [core options](https://www.npmjs.com/package/universal-rate-limit) — `windowMs`, `limit`, `algorithm`, `store`, `keyGenerator`, `skip`, `handler`, `message`, `statusCode`, `headers`, and `passOnStoreError`.

## Example

See [`examples/fastify`](https://github.com/kkonstantinov/universal-rate-limit/tree/main/examples/fastify) for a complete working app with integration tests.

## Documentation

**[View the full documentation](https://kkonstantinov.github.io/universal-rate-limit/)**

## License

MIT
