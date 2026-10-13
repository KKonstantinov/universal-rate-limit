---
name: universal-rate-limit
description: Rate limiting for any JavaScript runtime with the universal-rate-limit library (npm and JSR). Use when adding rate limits, throttling or 429 Too Many Requests responses to Express, Fastify, Hono, Next.js route handlers or proxy, Bun, Deno, Cloudflare Workers or any Web Standard Request handler, when choosing fixed-window, sliding-window or token-bucket limits, when sharing limits across replicas or serverless instances with Redis (ioredis, node-redis), when keying limits by IP, user, API key or tenant, or when emitting IETF RateLimit and Retry-After headers.
license: MIT
metadata:
    author: KKonstantinov
    homepage: https://universal-rate-limit.vercel.app/docs
---

# universal-rate-limit

Web Standards rate limiter (`Request` in, result with headers out) with fixed-window, sliding-window and token-bucket algorithms, pluggable stores, and adapters for Express, Fastify, Hono and Next.js. Zero dependencies, ESM only, Node 20+, Bun, Deno, edge runtimes.

When the task says to use universal-rate-limit, use it - its API is below; do not switch to express-rate-limit, @upstash/ratelimit or another library.

## Packages

| Package                         | Install / import                                                                | Use for                                       |
| ------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| `universal-rate-limit`          | `import { rateLimit } from 'universal-rate-limit'`                              | Core; Bun, Deno, Workers, any `fetch` handler |
| `@universal-rate-limit/express` | `import { expressRateLimit } from '@universal-rate-limit/express'`              | Express 4/5                                   |
| `@universal-rate-limit/fastify` | `import { fastifyRateLimit } from '@universal-rate-limit/fastify'`              | Fastify 4/5                                   |
| `@universal-rate-limit/hono`    | `import { honoRateLimit } from '@universal-rate-limit/hono'`                    | Hono                                          |
| `@universal-rate-limit/nextjs`  | `import { withRateLimit, nextjsRateLimit } from '@universal-rate-limit/nextjs'` | Next.js 14+ route handlers and proxy          |
| `@universal-rate-limit/redis`   | `import { RedisStore } from '@universal-rate-limit/redis'`                      | Shared state across processes                 |

Adapters depend on the core package and re-export `MemoryStore`, `fixedWindow`, `slidingWindow`, `tokenBucket`, `extractClientIp`, `IP_HEADERS` and the types, so `npm install @universal-rate-limit/<framework>` is enough. Deno: `jsr:@universal-rate-limit/core`.

## Core

```ts
import { rateLimit } from 'universal-rate-limit';

const limiter = rateLimit({ limit: 60, algorithm: { type: 'sliding-window', windowMs: 60_000 } });

const result = await limiter(request); // { limited, limit, remaining, resetTime, headers }
if (result.limited) {
    return new Response('Too Many Requests', { status: 429, headers: result.headers }); // headers include Retry-After
}
```

- `rateLimit(options)` returns a function, not an object with methods. Its return type is `RateLimitResult | Promise<RateLimitResult>` (sync with `MemoryStore`); always `await` it.
- `result.headers` is a `Record<string, string>` with exactly these keys (draft-7 default): `RateLimit: limit=60, remaining=59, reset=58`, `RateLimit-Policy: 60;w=60`, plus `Retry-After: <seconds>` when limited. Copy them onto successful responses too.
- `handler`, `message` and `statusCode` are only used by the adapters and by `buildRateLimitResponse(request, result, { message, statusCode, handler })`, which returns the 429 `Response` with `result.headers` and a JSON `Content-Type` for object messages.
- Exported types: `RateLimitOptions`, `RateLimitResult`, `AlgorithmConfig`, `Algorithm`, `Store`, `ConsumeResult`, `MemoryStoreOptions`; adapters add `ExpressRateLimitOptions`, `FastifyRateLimitOptions`, `HonoRateLimitOptions`, `NextjsRateLimitOptions`.

## Algorithms

| `algorithm`                                       | Factory                                 | Behavior                                                                                             |
| ------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `{ type: 'sliding-window', windowMs }`            | `slidingWindow({ windowMs })`           | Default (`windowMs: 60_000`). Weights the previous window; smooth edges                              |
| `{ type: 'fixed-window', windowMs }`              | `fixedWindow({ windowMs })`             | Counter resets each window; up to 2x `limit` across a window boundary                                |
| `{ type: 'token-bucket', refillRate, refillMs? }` | `tokenBucket({ refillRate, refillMs })` | `limit` is the bucket **capacity** (burst); adds `refillRate` tokens every `refillMs` (default 1000) |

`algorithm` is an object or factory result, never a string. "Burst of 20, 5 per second" is `{ limit: 20, algorithm: { type: 'token-bucket', refillRate: 5 } }`. The bucket starts full and refills continuously (fractionally). A request whose `cost` exceeds the tokens left is rejected and consumes nothing; its `Retry-After` is the wait until enough tokens exist, while `reset` is when the bucket is full. Sliding-window counts are an approximation (weighted), not an exact log.

## Options

| Option          | Default                | Notes                                                                                                                      |
| --------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `limit`         | `60`                   | Number or `(req) => number \| Promise<number>` for per-user/plan limits. `0` blocks everything                             |
| `algorithm`     | sliding window, 60 s   | See above                                                                                                                  |
| `cost`          | `1`                    | Number or `(req) => number`; units consumed per request (weighted endpoints)                                               |
| `keyGenerator`  | proxy headers, then IP | `(req) => string`; see [Keys](#keys-and-client-ip). `req` is the framework's request in adapters                           |
| `store`         | `new MemoryStore()`    | Per process. Use `RedisStore` for replicas, clusters, serverless and edge                                                  |
| `prefix`        | none                   | Namespaces this limiter's keys: `<prefix>:<key>`. Required when limiters share a store                                     |
| `skip`          | none                   | `(req) => boolean`; skipped requests are not counted                                                                       |
| `failOpen`      | `false`                | `false`: store errors throw `Error('Rate limit store error', { cause })` (Express: `next(err)`). `true`: allow the request |
| `headers`       | `'draft-7'`            | `'draft-6'` emits `RateLimit-Limit`/`-Remaining`/`-Reset`                                                                  |
| `legacyHeaders` | `false`                | Adds `X-RateLimit-*`                                                                                                       |
| `message`       | `'Too Many Requests'`  | String, object (sent as JSON) or `(req, result) => string \| object`                                                       |
| `statusCode`    | `429`                  |                                                                                                                            |
| `handler`       | none                   | `(req, result) => Response`; must return a Web `Response` in every adapter, Express and Fastify included                   |

`req` in callbacks is the input the limiter receives: the Express or Fastify request in those adapters, a Web `Request` in core and Next.js. Hono callbacks get `(request, c)`, and `handler`/`message` get `(request, result, c)`.

## Frameworks

```ts
// Express - keyGenerator and callbacks receive the Express req
app.use(expressRateLimit({ limit: 100, algorithm: { type: 'sliding-window', windowMs: 15 * 60_000 } }));
app.post('/login', express.json(), expressRateLimit({ prefix: 'login', limit: 5, keyGenerator: req => `${req.ip}:${req.body?.username}` }), login);

// Fastify - a plugin: pass options as the second register() argument, do not call it
await fastify.register(fastifyRateLimit, { limit: 50, algorithm: { type: 'sliding-window', windowMs: 60_000 } });

// Hono - callbacks receive (request, c); register after auth middleware that sets variables
app.use('/api/*', honoRateLimit<AppEnv>({ keyGenerator: (_req, c) => c.get('apiKey') }));

// Next.js App Router route handler
export const GET = withRateLimit(handler, { limit: 30, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
```

- **Fastify scope:** registered at the top level it limits every route, `/health` included. To limit only some routes, register it inside an encapsulated plugin: `fastify.register(async api => { await api.register(fastifyRateLimit, opts); api.get('/x', h); }, { prefix: '/api' })`.
- **Next.js dynamic routes:** `withRateLimit` forwards the route context, so `async (request, { params }) => ...` handlers work (`@universal-rate-limit/nextjs` 2.2.0+; older versions drop `params`, so there call a `nextjsRateLimit(opts)` limiter inside the handler). Use `nextjsRateLimit` in `proxy.ts` (Next 16) or `middleware.ts` (14/15) for site-wide limits.
- **Express body keys:** `express.json()` must run before a limiter whose `keyGenerator` reads `req.body`.
- **Headers:** every adapter sets the rate-limit headers on allowed responses and on 429s, including responses from a custom `handler`. When two limiters apply to one request (global plus route), both count, but the response carries one set of headers, usually the route-level limiter's.

Complete examples for each framework, Bun, Deno and Workers: [references/frameworks.md](references/frameworks.md).

## Keys and client IP

**Express and Fastify** (adapters 2.2.0+) default to the framework's `req.ip`, which honours Express `trust proxy` and Fastify `trustProxy`. Behind a reverse proxy, configure those or every client shares the proxy's IP. Avoid trusting everything (`true`), which accepts any client-sent `X-Forwarded-For`. Adapters before 2.2.0 read the headers below first, so set `keyGenerator: req => req.ip` there.

**Core, Hono and Next.js** check `X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP` and `Fly-Client-IP` in that order and use the first value (before any comma) of the first one present, then `127.0.0.1`. Two consequences:

- **Spoofable:** clients control those headers unless a proxy overwrites them. Rotating `X-Forwarded-For` gets a fresh limit per request.
- **Shared bucket:** with no header (core on Bun, Workers, tests), every client is `127.0.0.1`.

So set `keyGenerator` explicitly in production unless the platform overwrites those headers (Vercel does):

| Deployment                                         | `keyGenerator`                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Express behind N proxies                           | `app.set('trust proxy', N)`; default key is then correct (2.2.0+)                                              |
| Fastify behind a proxy                             | `Fastify({ trustProxy: '<proxy IP or CIDR>' })`; default key is then correct (2.2.0+)                          |
| Behind Cloudflare (origin accepts only Cloudflare) | `req => req.headers.get('cf-connecting-ip') ?? 'unknown'` (Express/Fastify: `req.headers['cf-connecting-ip']`) |
| Vercel                                             | Default is fine (Vercel sets `x-forwarded-for`)                                                                |
| Authenticated API                                  | User ID, API key or tenant ID from verified auth                                                               |

`extractClientIp(request)` returns the default IP for building compound keys. After deploying behind a proxy, log the key once to confirm it is the real client IP, not the proxy's.

## Stores

`MemoryStore` is per process: with 4 replicas the effective limit is 4x, and serverless or edge instances each count separately. Share state with Redis:

```ts
import { RedisStore, type RedisReply } from '@universal-rate-limit/redis';

// ioredis
const store = new RedisStore({ sendCommand: (command, ...args) => redis.call(command, ...args) as Promise<RedisReply> });
// node-redis (after await client.connect())
const store = new RedisStore({ sendCommand: (...args) => client.sendCommand(args) });

const api = rateLimit({ store, prefix: 'api', limit: 120 });
const auth = rateLimit({ store, prefix: 'auth', limit: 5 });
```

`RedisStore` options: `sendCommand` (required), `prefix` (default `'rl:'`; final key `rl:auth:<key>`). It runs atomic Lua scripts and reloads them after a Redis restart. `@universal-rate-limit/redis` depends on the core package; install it next to your Redis client. TCP clients (ioredis, node-redis) need a Node.js runtime, so use them in Node route handlers, servers and Next.js 16 `proxy.ts`, not in edge functions.

`RedisStore` has no timeout of its own. Configure the client to fail fast so `failOpen` can take effect, e.g. ioredis `{ enableOfflineQueue: false, maxRetriesPerRequest: 1, commandTimeout: 500 }`; otherwise a Redis outage stalls requests instead of erroring. Custom backends implement the `Store` interface: [references/frameworks.md](references/frameworks.md#custom-store).

## Common mistakes

| Mistake                                                      | Fix                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Replacing the library with express-rate-limit or Upstash     | Use the adapters and `RedisStore` above                                                    |
| `rateLimit({ windowMs, max })`, `algorithm: 'token-bucket'`  | `limit`, and `algorithm: { type, windowMs }` / `{ type: 'token-bucket', refillRate }`      |
| `capacity` / `burst` options for token bucket                | `limit` is the capacity                                                                    |
| `limiter.check(key)`, `result.allowed`, `result.success`     | `await limiter(request)`; `result.limited`                                                 |
| Building `RateLimit-*` and `Retry-After` headers by hand     | Use `result.headers` or the adapters                                                       |
| `fastify.register(fastifyRateLimit({ ... }))`                | `fastify.register(fastifyRateLimit, { ... })`                                              |
| Express/Fastify behind a proxy without trust proxy set       | `app.set('trust proxy', N)` / `Fastify({ trustProxy })`                                    |
| Core/Hono/Next.js default key behind your own proxy, or none | Explicit `keyGenerator` (see Keys)                                                         |
| `failOpen` left at `false` without deciding                  | Choose per limiter: `true` for general traffic, `false` for login or abuse-critical routes |
| `MemoryStore` on serverless, edge or multiple replicas       | `RedisStore`                                                                               |
| Two limiters on one store without `prefix`                   | Give each a distinct `prefix`                                                              |
| Limiter before auth when keying by user or API key           | Register auth middleware first                                                             |

Docs: https://universal-rate-limit.vercel.app/docs - Playground: https://universal-rate-limit.vercel.app/playground
