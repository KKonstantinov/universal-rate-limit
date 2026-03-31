# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A web-standards-based rate limiting library for any JS runtime/framework. Monorepo with a core library, Redis store, and middleware adapters for Express, Fastify, Hono, and Next.js.

## Commands

```bash
pnpm build                    # Build all packages (tsdown)
pnpm test                     # Run all unit tests (vitest)
pnpm test:integration         # Cross-package integration tests
pnpm test:all                 # Node + Bun + Deno tests
pnpm lint                     # ESLint
pnpm lint:fix                 # ESLint with auto-fix
pnpm format:check             # Prettier check
pnpm typecheck                # tsgo --noEmit per package
```

Run a single test file: `pnpm vitest run packages/core/test/rate-limit.test.ts`

Run tests for one package: `cd packages/core && pnpm test`

## Monorepo Layout

- **`packages/core`** — `universal-rate-limit`: framework-agnostic rate limiter using Web Standard `Request`/`Response`. Zero dependencies. Exports `rateLimit()`, `MemoryStore`, `buildRateLimitResponse()`.
- **`packages/redis`** — `@universal-rate-limit/redis`: Redis store using Lua scripts for atomic operations. Works with any Redis client via `SendCommandFn` abstraction.
- **`packages/middleware/{express,fastify,hono,nextjs}`** — Thin adapters that convert framework requests to Web `Request`, call core, set headers, handle 429s.
- **`packages/site`** — Documentation site built with [Fumadocs](https://www.fumadocs.dev/) (Next.js). Content lives in `packages/site/content/docs/`.
- **`packages/benchmarks`** — Private package. Run with `pnpm bench`, `pnpm bench:throughput`, etc.

## Architecture

**Core flow**: `rateLimit(options)` returns a function `(request) => RateLimitResult`. The result contains `limited`, `remaining`, `resetTime`, and IETF-compliant `headers`.

**Algorithms**: Fixed-window (simple counter) and sliding-window (weighted previous + current window). Both use the same `Store` interface (`increment()` / `get()` / `reset()`).

**MemoryStore**: Dual-map design (`current` + `previous` window maps) with background cleanup on `.unref()` timer.

**RedisStore**: Lua scripts loaded via `EVALSHA` with auto-reload on cache eviction.

**Header formats**: draft-7 (default, combined `RateLimit:` header), draft-6 (separate headers), optional legacy `X-RateLimit-*`.

**Key generator default**: Checks `x-forwarded-for` → `x-real-ip` → `cf-connecting-ip` → `fly-client-ip`, falls back to `127.0.0.1`.

## Code Conventions

- ESM-only (`"type": "module"`), target ES2022, Node >= 20
- Strict TypeScript with `@typescript-eslint/strict-type-checked`
- Prettier: 140 print width, 4-space indent, single quotes, no trailing commas, no semicolon-less
- Use `import type` for type-only imports (enforced by ESLint)
- Use `globalThis` not `global` (unicorn/prefer-global-this)
- Wrap numbers in `String()` inside template literals (restrict-template-expressions)
- Use numeric separators for 4+ digit numbers (e.g., `1_000`)
- Avoid multiple `Array#push()` calls — use array literal instead

## Adding a New Package

1. Add to `pnpm-workspace.yaml`
2. Add `src/` and `*.config.ts` paths to `tsconfig.eslint.json` include array
3. Package should extend `tsconfig.base.json`, use `tsdown` for build, export ESM with `.mts` extensions

## Pre-commit Hooks (Lefthook)

Runs build, lint (staged), format (staged), typecheck, and tests on changed files. If a hook fails, fix the issue — do not bypass with `--no-verify`.
