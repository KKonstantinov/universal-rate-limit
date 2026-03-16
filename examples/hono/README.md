# Hono Example — universal-rate-limit

A complete Hono app demonstrating rate limiting with [`@universal-rate-limit/hono`](https://www.npmjs.com/package/@universal-rate-limit/hono).

## How It Works

The Hono middleware applies rate limiting to all routes. When the limit is exceeded, a `429 Too Many Requests` response is returned automatically with IETF-compliant `RateLimit` headers.

```ts
// src/index.ts
import { Hono } from 'hono';
import { honoRateLimit } from '@universal-rate-limit/hono';

const app = new Hono();
app.use(honoRateLimit({ windowMs: 60_000, limit: 5 }));

app.get('/', c => {
    return c.json({ message: 'Hello from Hono!' });
});

export default app;
```

## Running

```bash
# From the monorepo root
pnpm install
pnpm build

# Start the dev server
pnpm --filter @universal-rate-limit/example-hono dev
```

## Testing

```bash
# Test with curl (notice the RateLimit headers)
curl -i http://localhost:3000/
curl -i http://localhost:3000/api/hello

# Run integration tests
pnpm --filter @universal-rate-limit/example-hono test:integration
```

## Structure

```
src/
  index.ts                  # Hono server with rate limiting
test/
  integration/              # Integration tests (starts real server)
```
