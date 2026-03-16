# Express Example — universal-rate-limit

A complete Express app demonstrating rate limiting with [`@universal-rate-limit/express`](https://www.npmjs.com/package/@universal-rate-limit/express).

## How It Works

The Express middleware applies rate limiting to all routes. When the limit is exceeded, a `429 Too Many Requests` response is returned automatically with IETF-compliant `RateLimit` headers.

```ts
// src/index.ts
import express from 'express';
import { expressRateLimit } from '@universal-rate-limit/express';

const app = express();
app.use(expressRateLimit({ windowMs: 60_000, limit: 5 }));

app.get('/', (req, res) => {
    res.json({ message: 'Hello from Express!' });
});

app.listen(3000);
```

## Running

```bash
# From the monorepo root
pnpm install
pnpm build

# Start the dev server
pnpm --filter @universal-rate-limit/example-express dev
```

## Testing

```bash
# Test with curl (notice the RateLimit headers)
curl -i http://localhost:3000/
curl -i http://localhost:3000/api/hello

# Run integration tests
pnpm --filter @universal-rate-limit/example-express test:integration
```

## Structure

```
src/
  index.ts                  # Express server with rate limiting
test/
  integration/              # Integration tests (starts real server)
```
