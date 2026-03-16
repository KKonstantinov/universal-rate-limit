# @universal-rate-limit/nextjs

Next.js App Router wrapper and Edge middleware for [universal-rate-limit](https://www.npmjs.com/package/universal-rate-limit) — a zero-dependency rate limiter built on web standards. Supports fixed-window and sliding-window algorithms, pluggable stores (memory, Redis, or your
own), and IETF-compliant rate limit headers out of the box.

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
    windowMs: 60_000, // 1 minute
    limit: 60 // 60 requests per window
});
```

### Edge Middleware

Use `nextjsRateLimit` for custom logic in Edge Middleware:

```ts
// middleware.ts
import { nextjsRateLimit } from '@universal-rate-limit/nextjs';
import { NextResponse } from 'next/server';

const limiter = nextjsRateLimit({
    windowMs: 60_000,
    limit: 60
});

export async function middleware(request: Request) {
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
```

## Options

Both `withRateLimit` and `nextjsRateLimit` accept all [core options](https://www.npmjs.com/package/universal-rate-limit) — `windowMs`, `limit`, `algorithm`, `store`, `keyGenerator`, `skip`, `handler`, `message`, `statusCode`, `headers`, and `passOnStoreError`.

## Example

See [`examples/nextjs`](https://github.com/kkonstantinov/universal-rate-limit/tree/main/examples/nextjs) for a complete Next.js App Router app with integration tests.

## Documentation

**[View the full documentation](https://kkonstantinov.github.io/universal-rate-limit/)**

## License

MIT
