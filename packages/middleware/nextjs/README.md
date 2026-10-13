<p align="center">
  <img src="https://raw.githubusercontent.com/kkonstantinov/universal-rate-limit/main/packages/middleware/nextjs/universal-rate-limit-nextjs.png" alt="@universal-rate-limit/nextjs" />
</p>

<h1 align="center">@universal-rate-limit/nextjs</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@universal-rate-limit/nextjs"><img src="https://img.shields.io/npm/v/@universal-rate-limit/nextjs.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@universal-rate-limit/nextjs"><img src="https://img.shields.io/npm/dm/@universal-rate-limit/nextjs.svg" alt="npm downloads" /></a>
  <a href="https://www.npmjs.com/package/@universal-rate-limit/nextjs"><img src="https://img.shields.io/npm/types/@universal-rate-limit/nextjs.svg" alt="types" /></a>
  <a href="https://github.com/kkonstantinov/universal-rate-limit/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@universal-rate-limit/nextjs.svg" alt="license" /></a>
</p>

Next.js App Router wrapper and proxy/middleware limiter for [universal-rate-limit](https://www.npmjs.com/package/universal-rate-limit) — a zero-dependency rate limiter built on web standards. Supports fixed-window, sliding-window, and token-bucket algorithms, pluggable stores
(memory, Redis, or your own), and IETF-compliant rate limit headers out of the box.

> **[Try the playground](https://universal-rate-limit.vercel.app/playground)** to see rate limiting in action.

## Install

```bash
npm install @universal-rate-limit/nextjs
```

## Usage

### App Router Route Handlers

Wrap your route handler with `withRateLimit`:

```ts
// app/api/hello/route.ts
import { withRateLimit } from '@universal-rate-limit/nextjs';

async function handler(request: Request) {
    return Response.json({ hello: 'world' });
}

export const GET = withRateLimit(handler, {
    algorithm: { type: 'sliding-window', windowMs: 60_000 }, // 1 minute
    limit: 60 // 60 requests per window
});
```

`withRateLimit` forwards the route context, so dynamic routes receive their `params`:

```ts
// app/api/users/[id]/route.ts
import { withRateLimit } from '@universal-rate-limit/nextjs';

async function handler(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return Response.json({ id });
}

export const GET = withRateLimit(handler, { limit: 30 });
```

### Proxy (site-wide)

Use `nextjsRateLimit` in `proxy.ts` (Next.js 16). On Next.js 14/15 the same code goes in `middleware.ts` with the function named `middleware`.

```ts
// proxy.ts
import { nextjsRateLimit } from '@universal-rate-limit/nextjs';
import { NextResponse } from 'next/server';

const limiter = nextjsRateLimit({
    algorithm: { type: 'sliding-window', windowMs: 60_000 },
    limit: 60
});

export async function proxy(request: Request) {
    const result = await limiter(request);

    if (result.limited) {
        return new Response('Too Many Requests', {
            status: 429,
            headers: result.headers
        });
    }

    const response = NextResponse.next();
    for (const [key, value] of Object.entries(result.headers)) {
        response.headers.set(key, value);
    }
    return response;
}

export const config = { matcher: ['/api/:path*'] };
```

### Production: use a shared store

The default `MemoryStore` lives in one process. Serverless functions (Vercel and similar), proxy instances and multiple servers each keep their own counts, so the effective limit is multiplied by the number of instances. Pass a
[`RedisStore`](https://www.npmjs.com/package/@universal-rate-limit/redis) to share state. Clients such as ioredis and node-redis need the Node.js runtime: Next.js 16 runs `proxy.ts` on Node.js, while Next.js 14/15 `middleware.ts` defaults to the Edge runtime (opt into Node.js
with `runtime: 'nodejs'` in its `config` on 15.5+).

The default key reads `x-forwarded-for` and related headers. That is safe on Vercel, which overwrites them; behind another proxy or CDN, set `keyGenerator` to a header your proxy controls.

## Options

Both `withRateLimit` and `nextjsRateLimit` accept all [core options](https://www.npmjs.com/package/universal-rate-limit) — `limit`, `algorithm`, `cost`, `store`, `keyGenerator`, `skip`, `handler`, `message`, `statusCode`, `headers`, `legacyHeaders`, `failOpen`, and `prefix`.

## Example

See [`examples/nextjs`](https://github.com/kkonstantinov/universal-rate-limit/tree/main/examples/nextjs) for a complete Next.js App Router app with integration tests.

## Documentation

**[View the full documentation](https://universal-rate-limit.vercel.app/docs)**

## License

MIT
