# @universal-rate-limit/redis

Redis store for [universal-rate-limit](https://www.npmjs.com/package/universal-rate-limit). Uses atomic Lua scripts to prevent race conditions — works with any Redis client library.

`universal-rate-limit` is a web-standards-based rate limiter with fixed-window and sliding-window algorithms, IETF-compliant headers, and drop-in middleware for Express, Fastify, Hono, and Next.js. This package lets you back it with Redis for multi-instance deployments.

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
    windowMs: 60_000,
    limit: 60,
    store: new RedisStore({
        sendCommand: (...args) => client.sendCommand(args),
        windowMs: 60_000
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
    windowMs: 60_000,
    limit: 60,
    store: new RedisStore({
        sendCommand: (...args) => redis.call(args[0], ...args.slice(1)),
        windowMs: 60_000
    })
});
```

## Options

```ts
new RedisStore({
    sendCommand, // Required — function that sends raw Redis commands
    windowMs, // Required — window duration in milliseconds
    prefix: 'rl:', // Key prefix for all rate limit keys
    resetExpiryOnChange: false // Reset TTL on every increment
});
```

## Documentation

**[View the full documentation](https://kkonstantinov.github.io/universal-rate-limit/)**

## License

MIT
