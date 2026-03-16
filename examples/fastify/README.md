# Fastify Example — universal-rate-limit

A complete Fastify app demonstrating rate limiting with [`@universal-rate-limit/fastify`](https://www.npmjs.com/package/@universal-rate-limit/fastify).

## How It Works

The Fastify plugin registers an `onRequest` hook that applies rate limiting to all routes. When the limit is exceeded, a `429 Too Many Requests` response is returned automatically with IETF-compliant `RateLimit` headers.

```ts
// src/index.ts
import Fastify from 'fastify';
import { fastifyRateLimit } from '@universal-rate-limit/fastify';

const app = Fastify();
await app.register(fastifyRateLimit, { windowMs: 60_000, limit: 5 });

app.get('/', async () => {
    return { message: 'Hello from Fastify!' };
});

await app.listen({ port: 3000 });
```

## Running

```bash
# From the monorepo root
pnpm install
pnpm build

# Start the dev server
pnpm --filter @universal-rate-limit/example-fastify dev
```

## Testing

```bash
# Test with curl (notice the RateLimit headers)
curl -i http://localhost:3000/
curl -i http://localhost:3000/api/hello

# Run integration tests
pnpm --filter @universal-rate-limit/example-fastify test:integration
```

## Structure

```
src/
  index.ts                  # Fastify server with rate limiting
test/
  integration/              # Integration tests (starts real server)
```
