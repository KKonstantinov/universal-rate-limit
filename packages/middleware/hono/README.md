<p align="center">
  <img src="https://raw.githubusercontent.com/kkonstantinov/universal-rate-limit/main/packages/middleware/hono/universal-rate-limit-hono.png" alt="@universal-rate-limit/hono" />
</p>

<h1 align="center">@universal-rate-limit/hono</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@universal-rate-limit/hono"><img src="https://img.shields.io/npm/v/@universal-rate-limit/hono.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@universal-rate-limit/hono"><img src="https://img.shields.io/npm/dm/@universal-rate-limit/hono.svg" alt="npm downloads" /></a>
  <a href="https://www.npmjs.com/package/@universal-rate-limit/hono"><img src="https://img.shields.io/npm/types/@universal-rate-limit/hono.svg" alt="types" /></a>
  <a href="https://github.com/kkonstantinov/universal-rate-limit/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@universal-rate-limit/hono.svg" alt="license" /></a>
</p>

Hono middleware for [universal-rate-limit](https://www.npmjs.com/package/universal-rate-limit) — a zero-dependency rate limiter built on web standards. Supports fixed-window, sliding-window, and token-bucket algorithms, pluggable stores (memory, Redis, or your own), and
IETF-compliant rate limit headers out of the box. Works on Node.js, Bun, Deno, Cloudflare Workers, and other edge runtimes.

> **[Try the playground](https://universal-rate-limit.vercel.app/playground)** to see rate limiting in action.

## Install

```bash
npm install @universal-rate-limit/hono
```

## Usage

```ts
import { Hono } from 'hono';
import { honoRateLimit } from '@universal-rate-limit/hono';

const app = new Hono();

// Apply to all routes
app.use(
    honoRateLimit({
        algorithm: { type: 'sliding-window', windowMs: 60_000 }, // 1 minute
        limit: 60 // 60 requests per window
    })
);

// Or apply to specific routes
app.use(
    '/api/*',
    honoRateLimit({
        algorithm: { type: 'sliding-window', windowMs: 60_000 },
        limit: 30
    })
);

export default app;
```

## Options

Accepts all [core options](https://www.npmjs.com/package/universal-rate-limit) — `limit`, `algorithm`, `cost`, `store`, `keyGenerator`, `skip`, `handler`, `message`, `statusCode`, `headers`, `legacyHeaders`, `failOpen`, and `prefix`.

### Typed Hono context

`honoRateLimit<AppEnv>()` passes `Context<AppEnv>` as the final argument to every callback. The original Web `Request` remains the first argument, so existing Request-only callbacks continue to work. Register authentication middleware before the limiter when keys or allowances
depend on verified identity; the limiter does not authenticate callers itself.

```ts
import { Hono } from 'hono';
import { honoRateLimit } from '@universal-rate-limit/hono';

type AppEnv = {
    Variables: {
        tenantId: string;
        apiLimit: number;
    };
};

const app = new Hono<AppEnv>();

// Register your authentication middleware here. It must verify the caller
// and set tenantId and apiLimit before the limiter runs.
app.use(
    '/api/*',
    honoRateLimit<AppEnv>({
        algorithm: { type: 'token-bucket', refillRate: 5 },
        keyGenerator: (_request, c) => c.get('tenantId'),
        limit: (_request, c) => c.get('apiLimit'),
        cost: (_request, c) => (c.req.path === '/api/export' ? 5 : 1),
        handler: (_request, result, c) => c.json({ error: 'Too many requests', tenantId: c.get('tenantId'), remaining: result.remaining }, 429)
    })
);
```

| Callback        | Arguments                    | Return value                                            |
| --------------- | ---------------------------- | ------------------------------------------------------- |
| `keyGenerator`  | `(request, context)`         | String or promise of a string                           |
| `limit`, `cost` | `(request, context)`         | Number or promise of a number; static numbers also work |
| `skip`          | `(request, context)`         | Boolean or promise of a boolean                         |
| `handler`       | `(request, result, context)` | `Response` or promise of a `Response`                   |
| `message`       | `(request, result, context)` | String or object; static strings and objects also work  |

Use a shared store for limits across multiple processes or replicas; the default memory store is local to one middleware instance. The default IP key reads forwarding headers, so deployments using IP-based limits must ensure those headers come from a trusted proxy.

### Response handling

The adapter preserves custom refusal status, status text, headers, cookies and body without decoding or buffering the body. Custom header values take precedence over inherited context values, while cookies from both sources are retained without duplicating identical values.
Generated rate-limit headers take precedence on the limiter's own refusal response.

Rate-limit headers are applied after downstream handling, including raw `Response` objects, redirects and responses produced by Hono's error handler. When limiters are nested, an admitted outer limiter preserves the inner limiter's existing rate-limit headers.

## Example

See [`examples/hono`](https://github.com/kkonstantinov/universal-rate-limit/tree/main/examples/hono) for a complete working app with integration tests.

## Documentation

**[View the full documentation](https://universal-rate-limit.vercel.app/docs)**

## License

MIT
