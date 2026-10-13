# Framework and runtime examples

All examples share these ideas: pick an algorithm, set an explicit `keyGenerator` in production, use `RedisStore` when more than one process serves traffic, and give each limiter on a shared store its own `prefix`.

## Express

```ts
import express from 'express';
import { Redis } from 'ioredis';
import { expressRateLimit, type RateLimitResult } from '@universal-rate-limit/express';
import { RedisStore, type RedisReply } from '@universal-rate-limit/redis';

// Fail fast while Redis is down, so failOpen/failClosed takes effect instead of requests queueing
const redis = new Redis(process.env.REDIS_URL!, { enableOfflineQueue: false, maxRetriesPerRequest: 1, commandTimeout: 500 });
const store = new RedisStore({ sendCommand: (command, ...args) => redis.call(command, ...args) as Promise<RedisReply> });

const app = express();
app.set('trust proxy', 1); // one proxy hop (e.g. nginx ingress); req.ip is then the client - log it once to confirm

const rateLimited = (_req: express.Request, result: RateLimitResult) => ({
    error: 'rate_limited',
    retryAfter: Number(result.headers['Retry-After']) // same value as the Retry-After header
});

// Global: 100 requests per 15 minutes per client
app.use(
    expressRateLimit({
        store,
        prefix: 'global',
        limit: 100,
        algorithm: { type: 'sliding-window', windowMs: 15 * 60_000 },
        keyGenerator: req => req.ip ?? 'unknown', // the default on 2.2.0+; explicit keeps older adapters safe
        skip: req => req.path === '/healthz',
        message: rateLimited,
        failOpen: true // Redis outage: let traffic through
    })
);

// Login: 5 attempts per minute per IP + username (express.json() first so req.body exists)
app.post(
    '/login',
    express.json(),
    expressRateLimit({
        store,
        prefix: 'login',
        limit: 5,
        algorithm: { type: 'sliding-window', windowMs: 60_000 },
        keyGenerator: req => `${req.ip ?? 'unknown'}:${String(req.body?.username ?? '').toLowerCase()}`,
        message: rateLimited,
        failOpen: false // Redis outage: next(err) with 'Rate limit store error' rather than unlimited guessing
    }),
    (req, res) => res.json({ ok: true })
);
```

Route-level: `app.use('/api/', expressRateLimit(opts))` or pass the middleware to a single route as above. A `message` object is sent as JSON with the right `Content-Type`; `Retry-After` and `RateLimit` headers are set automatically on 429s and allowed responses. With `failOpen: false`, add an Express error handler that turns the store error into a 503. Skip health-check and readiness probe paths, or the platform may restart healthy pods when they get 429s.

## Fastify

```ts
import Fastify from 'fastify';
import { fastifyRateLimit } from '@universal-rate-limit/fastify';

// Behind a proxy: replace with its IP or CIDR so req.ip is the client. Directly exposed: omit trustProxy.
const fastify = Fastify({ trustProxy: '10.0.0.0/8' });

fastify.get('/health', async () => ({ ok: true })); // not limited

await fastify.register(
    async api => {
        await api.register(fastifyRateLimit, {
            limit: 50,
            algorithm: { type: 'sliding-window', windowMs: 60_000 },
            keyGenerator: req => req.ip // the default on 2.2.0+; explicit keeps older adapters safe
        });
        api.get('/users', async () => []);
    },
    { prefix: '/api' }
);
```

The plugin is wrapped with `fastify-plugin`, so its `onRequest` hook applies to the context that registers it: top level means every route, inside an encapsulated plugin means only that plugin's routes. The limiter's own `prefix` option (key namespace) is separate from Fastify's route `prefix` on the outer `register`.

## Hono

```ts
import { Hono } from 'hono';
import { honoRateLimit } from '@universal-rate-limit/hono';

type AppEnv = { Variables: { apiKey: string } };
const app = new Hono<AppEnv>();

app.use('/api/*', authMiddleware); // must set c.var.apiKey before the limiter runs
app.use(
    '/api/*',
    honoRateLimit<AppEnv>({
        limit: 100, // bucket capacity
        algorithm: { type: 'token-bucket', refillRate: 10 }, // 10 tokens per second
        keyGenerator: (_request, c) => c.get('apiKey'),
        cost: (_request, c) => (c.req.method === 'POST' && c.req.path === '/api/export' ? 10 : 1),
        handler: (_request, result, c) => c.json({ error: 'rate_limited', remaining: result.remaining }, 429)
    })
);
```

Every callback receives the Web `Request` first and the Hono `Context` last: `keyGenerator`, `limit`, `cost`, `skip` get `(request, c)`; `handler` and `message` get `(request, result, c)`. On Cloudflare Workers each isolate has its own `MemoryStore`; for a global limit use a shared store (implement `Store`, below).

## Next.js

Static route handler:

```ts
// app/api/hello/route.ts
import { withRateLimit } from '@universal-rate-limit/nextjs';

export const GET = withRateLimit(async () => Response.json({ hello: 'world' }), {
    limit: 30,
    algorithm: { type: 'sliding-window', windowMs: 60_000 }
});
```

Shared store module (serverless instances do not share memory; one Redis client per instance):

```ts
// lib/rate-limit-store.ts
import { Redis } from 'ioredis';
import { MemoryStore, type Store } from '@universal-rate-limit/nextjs';
import { RedisStore, type RedisReply } from '@universal-rate-limit/redis';

const globalForRedis = globalThis as typeof globalThis & { rateLimitRedis?: Redis };

function redis(): Redis {
    // lazyConnect: no connection at import time (next build); cached on globalThis to survive dev hot reloads
    globalForRedis.rateLimitRedis ??= new Redis(process.env.REDIS_URL!, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 500
    });
    return globalForRedis.rateLimitRedis;
}

export const store: Store = process.env.REDIS_URL ? new RedisStore({ sendCommand: (command, ...args) => redis().call(command, ...args) as Promise<RedisReply> }) : new MemoryStore(); // local development only
```

Use a TCP Redis URL (`redis://` or `rediss://`) for ioredis. If preview and production share one Redis, add the environment to the store prefix, e.g. `new RedisStore({ sendCommand, prefix: 'rl:' + process.env.VERCEL_ENV + ':' })`.

Dynamic route (`withRateLimit` forwards the route context in `@universal-rate-limit/nextjs` 2.2.0+):

```ts
// app/api/users/[id]/route.ts
import { withRateLimit } from '@universal-rate-limit/nextjs';
import { store } from '@/lib/rate-limit-store'; // RedisStore on Vercel and other serverless hosts

async function handler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return Response.json({ id });
}

export const GET = withRateLimit(handler, { store, prefix: 'users', limit: 30, algorithm: { type: 'sliding-window', windowMs: 60_000 } });
```

On `@universal-rate-limit/nextjs` before 2.2.0, `withRateLimit` drops `params`; call the limiter inside the handler instead:

```ts
import { nextjsRateLimit } from '@universal-rate-limit/nextjs';
import { store } from '@/lib/rate-limit-store';

const limiter = nextjsRateLimit({ store, prefix: 'users', limit: 30, algorithm: { type: 'sliding-window', windowMs: 60_000 } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const result = await limiter(request);
    if (result.limited) {
        return new Response('Too Many Requests', { status: 429, headers: result.headers });
    }
    const { id } = await params;
    return Response.json({ id }, { headers: result.headers });
}
```

Site-wide in `proxy.ts`. Next.js 16 runs `proxy.ts` on the Node.js runtime, so ioredis works there. On 14/15 the file is `middleware.ts` with a `middleware` function, and it runs on the Edge runtime by default, where ioredis cannot connect: on 15.5+ add `runtime: 'nodejs'` to its `config`, otherwise limit in route handlers instead.

```ts
// proxy.ts
import { NextResponse, type NextRequest } from 'next/server';
import { nextjsRateLimit } from '@universal-rate-limit/nextjs';
import { store } from '@/lib/rate-limit-store';

const limiter = nextjsRateLimit({
    store,
    prefix: 'api', // distinct from route-level limiters on the same store
    limit: 20, // burst capacity
    algorithm: { type: 'token-bucket', refillRate: 5 }, // 5 tokens per second
    failOpen: true // a Redis blip must not take down every /api route
});

export async function proxy(request: NextRequest) {
    const result = await limiter(request);
    if (result.limited) {
        return new NextResponse('Too Many Requests', { status: 429, headers: result.headers });
    }
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(result.headers)) response.headers.set(key, value);
    return response;
}

export const config = { matcher: ['/api/:path*'] };
```

A request to `/api/users/123` passes both limiters and spends from both. The default key generator reads `x-forwarded-for`, which Vercel sets; behind another proxy or CDN, set `keyGenerator` to its client-IP header. Every request through a limiter costs a Redis round trip, so keep Redis in the same region as the functions.

## Bun, Deno and Cloudflare Workers (core only)

`rateLimit<TRequest>()` accepts any input type, so pass the socket IP alongside the request when the platform provides it:

```ts
import { rateLimit, buildRateLimitResponse } from 'universal-rate-limit';

type Input = { request: Request; ip: string };
const limiter = rateLimit<Input>({
    limit: 60,
    algorithm: { type: 'sliding-window', windowMs: 60_000 },
    keyGenerator: ({ ip }) => ip
});

Bun.serve({
    async fetch(request, server) {
        const input = { request, ip: server.requestIP(request)?.address ?? 'unknown' };
        const result = await limiter(input);
        if (result.limited) return buildRateLimitResponse(input, result, { message: { error: 'rate_limited' } });
        const response = new Response('ok');
        for (const [key, value] of Object.entries(result.headers)) response.headers.set(key, value);
        return response;
    }
});
```

- **Deno:** `Deno.serve((request, info) => ...)` with `info.remoteAddr.hostname` as the IP; import from `jsr:@universal-rate-limit/core` or `npm:universal-rate-limit`.
- **Cloudflare Workers:** `keyGenerator: req => req.headers.get('cf-connecting-ip') ?? 'unknown'` with a plain `rateLimit()`; state is per isolate unless you supply a shared store.
- Responses from `fetch()` have immutable headers; copy with `new Response(res.body, res)` before setting rate-limit headers.

## Custom store

```ts
import type { Store, Algorithm, ConsumeResult } from 'universal-rate-limit';

interface Kv {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown, ttlMs: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}

class KvStore implements Store {
    constructor(private readonly kv: Kv) {}

    async consume(key: string, algorithm: Algorithm, limit: number, cost = 1): Promise<ConsumeResult> {
        const state = await this.kv.get(key);
        const { next, result } = algorithm.consume(state, limit, Date.now(), cost);
        await this.kv.set(key, next, algorithm.ttlMs(limit));
        return result;
    }
    async resetKey(key: string): Promise<void> {
        await this.kv.delete(key);
    }
    async resetAll(): Promise<void> {
        await this.kv.clear();
    }
    // Optional: prefix, peek(key, algorithm, limit), unconsume(key, algorithm, limit, cost), shutdown()
}
```

The algorithm owns all the math; the store only persists its opaque state. The get-then-set above is not atomic: under concurrency it undercounts, so production stores need a transaction, Lua script or compare-and-set per key (as `RedisStore` does). `MemoryStore` in the core package is the reference implementation.
