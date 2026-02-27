# universal-rate-limit — Project Reference

## Overview

`universal-rate-limit` is a web-standards-based rate limiting library built on the `Request`/`Response` APIs. The core is runtime-agnostic (Node, Deno, Bun) and ships with thin middleware adapters for Hono, Express, Fastify, and Next.js.

The design is inspired by `express-rate-limit` but rebuilt from scratch around web standards so the same core logic works everywhere.

## Architecture & Design Decisions

### Core pattern: `(Request) => Promise<RateLimitResult>`

The core exports a `rateLimit(options)` factory that returns an async function operating on standard `Request` objects. This makes it framework-agnostic — middleware adapters simply convert their framework's request type to a web `Request`, call the core, and map the result back.

```
rateLimit(options) → async (Request) → RateLimitResult { limited, limit, remaining, resetTime, headers }
```

### Middleware adapters are thin wrappers

Each adapter package (`@universal-rate-limit/hono`, `/express`, `/fastify`, `/nextjs`) has a single responsibility: convert framework request → web `Request`, call core, set headers, handle 429 responses. No business logic lives in adapters.

- **Hono**: Returns `MiddlewareHandler`, uses `c.req.raw`
- **Express**: Returns `RequestHandler`, converts `req` to `new Request()`
- **Fastify**: Registered via `fastify-plugin` (breaks encapsulation), `onRequest` hook
- **Next.js**: `withRateLimit(handler, options)` wraps App Router route handlers; `nextjsRateLimit(options)` returns raw checker for Edge Middleware

### Pluggable store interface

```ts
interface Store {
    increment(key: string): Promise<IncrementResult>; // { totalHits, resetTime }
    decrement(key: string): Promise<void>;
    resetKey(key: string): Promise<void>;
    resetAll(): Promise<void>;
}
```

Ships with `MemoryStore`. External stores (Redis, KV, etc.) implement the same interface. The `decrement` method exists to support future `skipSuccessfulRequests` / `skipFailedRequests` features (decrement after response if request shouldn't count).

### MemoryStore: dual-map design

`MemoryStore` uses two Maps (`current` and `previous`) to support both fixed-window and sliding-window algorithms without extra data structures:

- **Fixed window**: Increment in `current`, reset when window expires
- **Sliding window**: `weightedCount = previousHits * (1 - elapsedRatio) + currentHits`

A cleanup timer runs every `windowMs` (with `.unref()` so it doesn't keep the process alive).

### Headers: draft-6 vs draft-7

`headers: 'draft-7' | 'draft-6'` option (default: `'draft-7'`):

- **draft-7** (default): Combined format per latest IETF RFCs — `RateLimit: limit=N, remaining=N, reset=N` + `RateLimit-Policy: N;w=N`
- **draft-6**: Legacy separate headers — `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`

### Default key generator

Checks IP headers in order: `x-forwarded-for` → `x-real-ip` → `cf-connecting-ip` → `fly-client-ip`, falls back to `'127.0.0.1'`. For `x-forwarded-for`, takes only the first (leftmost) IP.

### `buildRateLimitResponse` helper

Shared helper used by all middleware adapters to construct 429 responses. Handles string messages, JSON objects, and function messages. Adapters call this when `result.limited === true`.

## Monorepo Structure

```
packages/
├── core/                    → universal-rate-limit (npm)
└── middleware/
    ├── hono/                → @universal-rate-limit/hono
    ├── express/             → @universal-rate-limit/express
    ├── fastify/             → @universal-rate-limit/fastify
    └── nextjs/              → @universal-rate-limit/nextjs
```

## Tooling

| Tool                     | Purpose                                               |
| ------------------------ | ----------------------------------------------------- |
| pnpm 10.x workspaces     | Monorepo management                                   |
| TypeScript ^5.7 (strict) | Type safety                                           |
| tsdown (rolldown)        | ESM builds (`.mjs` + `.d.mts`)                        |
| vitest                   | Unit + integration tests                              |
| ESLint 10 flat config    | TS strict + unicorn + prettier                        |
| Prettier                 | 4-space, single quotes, 140 width, no trailing commas |
| Lefthook                 | Pre-commit: lint, format, test (parallel)             |
| Changesets               | Versioning & npm publishing                           |

## Feature Roadmap

### Tier 1 — Core Essentials (Implemented)

| #   | Feature                                                         | Status |
| --- | --------------------------------------------------------------- | ------ |
| 1   | Fixed window rate limiting                                      | Done   |
| 2   | Configurable `windowMs` (default: 60s)                          | Done   |
| 3   | Configurable `limit` — number or async function                 | Done   |
| 4   | Custom `keyGenerator` — async, default: IP from headers         | Done   |
| 5   | Pluggable store interface + `MemoryStore`                       | Done   |
| 6   | Rate limit headers — `draft-6` / `draft-7` (default: `draft-7`) | Done   |
| 7   | Custom exceeded `handler`                                       | Done   |
| 8   | Custom `message` — string, JSON, or function                    | Done   |
| 9   | Configurable `statusCode` (default: 429)                        | Done   |
| 10  | `skip` function                                                 | Done   |
| 11  | `passOnStoreError` — fail open vs fail closed                   | Done   |

### Tier 2 — Valuable Additions (Partially Implemented)

| #   | Feature                        | Status      | Notes                                                                                      |
| --- | ------------------------------ | ----------- | ------------------------------------------------------------------------------------------ |
| 1   | Sliding window algorithm       | Done        | Pulled into initial release; `algorithm: 'sliding-window'` option                          |
| 2   | `skipSuccessfulRequests`       | Not started | Don't count 2xx responses against the limit (post-response counting via `store.decrement`) |
| 3   | `skipFailedRequests`           | Not started | Don't count 4xx/5xx responses against the limit                                            |
| 4   | Custom `requestWasSuccessful`  | Not started | Override success determination logic (used by skipSuccessful/skipFailed)                   |
| 5   | Legacy `X-RateLimit-*` headers | Not started | Older-style headers for backward compatibility                                             |

### Tier 3 — Nice to Have (Not Started)

| #   | Feature                     | Status      | Notes                                                                          |
| --- | --------------------------- | ----------- | ------------------------------------------------------------------------------ |
| 1   | Request property decoration | Not started | Attach rate limit info (limit, remaining, reset) to request for downstream use |
| 2   | IPv6 subnet grouping        | Not started | Group IPv6 addresses by configurable /prefix                                   |
| 3   | Named policies / identifier | Not started | Support multiple named rate limiters with distinct headers                     |

## Key Files

| File                                       | Purpose                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `packages/core/src/index.ts`               | All core logic: types, `rateLimit()`, `MemoryStore`, `buildRateLimitResponse` |
| `packages/core/test/index.test.ts`         | 24 core tests                                                                 |
| `packages/middleware/hono/src/index.ts`    | Hono adapter                                                                  |
| `packages/middleware/express/src/index.ts` | Express adapter                                                               |
| `packages/middleware/fastify/src/index.ts` | Fastify adapter (uses `fastify-plugin`)                                       |
| `packages/middleware/nextjs/src/index.ts`  | Next.js adapter (`withRateLimit` + `nextjsRateLimit`)                         |
| `eslint.config.ts`                         | ESLint flat config (strict TS + unicorn + prettier)                           |
| `.github/workflows/ci.yml`                 | Lint + test on Node 20 & 22                                                   |
| `.github/workflows/release.yml`            | Changesets-based npm publish                                                  |

## Test Coverage

43 tests across 5 suites:

- **Core** (24): fixed window, sliding window, MemoryStore ops, headers, keyGenerator, skip, passOnStoreError, custom handler/message/statusCode, async limit
- **Hono** (5): allow, block, headers, draft-6, custom message
- **Express** (4): allow, block, headers, custom message
- **Fastify** (4): allow, block, headers, custom message (uses `app.inject()`)
- **Next.js** (6): `withRateLimit` pass-through/headers/block/custom message, `nextjsRateLimit` checker
