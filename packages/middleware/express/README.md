# @universal-rate-limit/express

Express middleware for [universal-rate-limit](https://www.npmjs.com/package/universal-rate-limit) — a zero-dependency rate limiter built on web standards. Supports fixed-window and sliding-window algorithms, pluggable stores (memory, Redis, or your own), and IETF-compliant rate
limit headers out of the box.

## Install

```bash
npm install @universal-rate-limit/express
```

## Usage

```ts
import express from 'express';
import { expressRateLimit } from '@universal-rate-limit/express';

const app = express();

// Apply to all routes
app.use(
    expressRateLimit({
        windowMs: 60_000, // 1 minute
        limit: 60 // 60 requests per window
    })
);

// Or apply to specific routes
app.use(
    '/api',
    expressRateLimit({
        windowMs: 60_000,
        limit: 30
    })
);

app.listen(3000);
```

## Options

Accepts all [core options](https://www.npmjs.com/package/universal-rate-limit) — `windowMs`, `limit`, `algorithm`, `store`, `keyGenerator`, `skip`, `handler`, `message`, `statusCode`, `headers`, and `passOnStoreError`.

## Documentation

**[View the full documentation](https://kkonstantinov.github.io/universal-rate-limit/)**

## License

MIT
