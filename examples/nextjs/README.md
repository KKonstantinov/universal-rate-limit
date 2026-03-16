# Next.js Example — universal-rate-limit

A complete Next.js App Router app demonstrating rate limiting with [`@universal-rate-limit/nextjs`](https://www.npmjs.com/package/@universal-rate-limit/nextjs).

## How It Works

Each API route handler is wrapped with `withRateLimit`, which evaluates the rate limit before calling the handler. When the limit is exceeded, a `429 Too Many Requests` response is returned automatically with IETF-compliant `RateLimit` headers.

```ts
// src/app/api/hello/route.ts
import { withRateLimit } from '@universal-rate-limit/nextjs';

async function handler() {
    return Response.json({ hello: 'world' });
}

export const GET = withRateLimit(handler, {
    windowMs: 60_000,
    limit: 5
});
```

## Running

```bash
# From the monorepo root
pnpm install
pnpm build

# Start the dev server
pnpm --filter @universal-rate-limit/example-nextjs dev
```

## Testing

```bash
# Test with curl (notice the RateLimit headers)
curl -i http://localhost:3000/api/hello
curl -i http://localhost:3000/api/data

# Run integration tests
pnpm --filter @universal-rate-limit/example-nextjs test:integration
```

## Structure

```
src/
  app/
    layout.tsx              # Root layout
    page.tsx                # Home page
    api/
      hello/route.ts        # Rate-limited API route
      data/route.ts         # Rate-limited API route
test/
  integration/              # Integration tests (spawns next dev)
```
