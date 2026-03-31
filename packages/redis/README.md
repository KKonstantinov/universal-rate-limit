<p align="center">
  <img src="https://raw.githubusercontent.com/kkonstantinov/universal-rate-limit/main/packages/redis/universal-rate-limit-redis.png" alt="@universal-rate-limit/redis" />
</p>

<h1 align="center">@universal-rate-limit/redis</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@universal-rate-limit/redis"><img src="https://img.shields.io/npm/v/@universal-rate-limit/redis.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@universal-rate-limit/redis"><img src="https://img.shields.io/npm/dm/@universal-rate-limit/redis.svg" alt="npm downloads" /></a>
  <a href="https://www.npmjs.com/package/@universal-rate-limit/redis"><img src="https://img.shields.io/npm/types/@universal-rate-limit/redis.svg" alt="types" /></a>
  <a href="https://github.com/kkonstantinov/universal-rate-limit/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@universal-rate-limit/redis.svg" alt="license" /></a>
</p>

Redis store for [universal-rate-limit](https://www.npmjs.com/package/universal-rate-limit). Uses atomic Lua scripts to prevent race conditions — works with any Redis client library.

`universal-rate-limit` is a web-standards-based rate limiter with fixed-window, sliding-window, and token-bucket algorithms, IETF-compliant headers, and drop-in middleware for Express, Fastify, Hono, and Next.js. This package lets you back it with Redis for multi-instance
deployments.

> **[Try the playground](https://universal-rate-limit.vercel.app/playground)** to see rate limiting in action.

## Install

```bash
npm install @universal-rate-limit/redis universal-rate-limit
```

## Usage

Provide a `sendCommand` function that sends raw Redis commands. This makes the store compatible with any Redis client (redis, ioredis, Upstash, etc.).

### With node-redis

```ts
import { createClient } from 'redis';
import { rateLimit } from 'universal-rate-limit';
import { RedisStore } from '@universal-rate-limit/redis';

const client = createClient();
await client.connect();

const limiter = rateLimit({
    algorithm: { type: 'sliding-window', windowMs: 60_000 },
    limit: 60,
    store: new RedisStore({
        sendCommand: (...args) => client.sendCommand(args)
    })
});
```

### With ioredis

```ts
import Redis from 'ioredis';
import { rateLimit } from 'universal-rate-limit';
import { RedisStore } from '@universal-rate-limit/redis';

const redis = new Redis();

const limiter = rateLimit({
    algorithm: { type: 'sliding-window', windowMs: 60_000 },
    limit: 60,
    store: new RedisStore({
        sendCommand: (...args) => redis.call(args[0], ...args.slice(1))
    })
});
```

## Options

```ts
new RedisStore({
    sendCommand, // Required — function that sends raw Redis commands
    prefix: 'rl:' // Key prefix for all rate limit keys
});
```

## Documentation

**[View the full documentation](https://universal-rate-limit.vercel.app/docs)**

## License

MIT
