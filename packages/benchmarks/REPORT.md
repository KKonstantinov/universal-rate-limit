# Performance Comparison: `@universal-rate-limit/express` vs `express-rate-limit`

**Date:** 2026-03-02 **Environment:** Node.js v24.13.0 · macOS Darwin 25.2.0 · Apple Silicon (arm64) **Versions:** `universal-rate-limit` 0.1.0 · `express-rate-limit` 8.2.1

---

## Summary

| Metric                             | @universal-rate-limit/express | express-rate-limit | Difference                 |
| ---------------------------------- | ----------------------------- | ------------------ | -------------------------- |
| Bundle size (ESM, raw)             | **13.2 KB**                   | 32.4 KB            | **2.4x smaller**           |
| Bundle size (ESM, gzip)            | **4.7 KB**                    | 8.8 KB             | **1.9x smaller**           |
| Runtime dependencies               | **0**                         | 1 (`ip-address`)   | —                          |
| Middleware throughput (multi-key)  | **3,582K ops/sec**            | 1,453K ops/sec     | **2.47x faster**           |
| Middleware throughput (single-key) | **3,886K ops/sec**            | 1,499K ops/sec     | **2.59x faster**           |
| Memory per key (100K keys)         | 228 B/key                     | **207 B/key**      | 1.10x more memory (see §4) |
| Memory total (100K keys)           | 21.76 MB                      | **19.73 MB**       | 1.10x more memory (see §4) |
| HTTP req/sec (real Express server) | 16,155 req/sec                | 16,057 req/sec     | ~1.01x (within noise)      |

---

## 1. Bundle Size

Both libraries were measured using their published ESM dist bundles.

```
@universal-rate-limit/express (core + adapter):
  packages/core/dist/index.mjs          10,367 B  (3,485 B gzip)
  packages/middleware/express/dist/       2,860 B  (1,232 B gzip)
  Combined:                             13,227 B  (4,717 B gzip)

express-rate-limit:
  dist/index.mjs                        32,374 B  (8,803 B gzip)
```

**How measured:** Raw byte count of built `.mjs` files via `wc -c`, gzip via `gzip -c | wc -c`.

`universal-rate-limit` ships zero runtime dependencies. `express-rate-limit` depends on `ip-address@10.0.1` for IPv6 subnet normalization, adding to the total install footprint.

### Why it's smaller

- No validation framework (~350 lines in express-rate-limit dedicated to runtime option checking, IP validation, trust-proxy detection, deprecation warnings, and creation stack traces)
- No legacy store compatibility layer (`promisifyStore`, `isLegacyStore`)
- No `node:crypto` or `node:buffer` imports (express-rate-limit uses SHA-256 hashing for draft-8 partition keys)
- No skip-request event listeners (`skipFailedRequests`/`skipSuccessfulRequests` require attaching `finish`/`close`/`error` listeners on every response)
- IPv6 subnet handling is deferred to the user's key generator rather than bundled

---

## 2. Middleware Throughput

Both libraries were tested as Express middleware using identical mock `req`/`res`/`next` objects in a tight async loop. No HTTP server or network involved — this isolates the middleware logic.

```
Express Middleware Throughput Benchmark
======================================================================
Operations: 100,000 | Warmup: 10,000 | Keys: 1000

Results:
----------------------------------------------------------------------
Middleware                                    ops/sec   avg (µs)   total (ms)
----------------------------------------------------------------------
@universal-rate-limit/express               3,581,817       0.28         27.9
express-rate-limit                          1,452,780       0.69         68.8
@universal-rate-limit/express (single key)  3,886,080       0.26         25.7
express-rate-limit (single key)             1,498,610       0.67         66.7
----------------------------------------------------------------------
```

**How measured:** `pnpm bench:throughput` — each iteration creates a mock Express request with an IP from a pool of 1,000 keys, passes it through the middleware, and calls `next()`. Wall-clock time measured via `performance.now()`. 10,000 warmup iterations discarded to stabilize
JIT. Both libraries configured identically: 60s window, draft-7 headers, in-memory store. `express-rate-limit` validations disabled (`validate: false`) for fairness since universal-rate-limit doesn't have runtime validation overhead.

### Why it's faster

- **Fully synchronous hot path:** When the store is synchronous (MemoryStore), key generator is synchronous, and limit is static, the entire middleware executes without creating any Promises. Express-rate-limit always wraps everything in `handleAsyncErrors` with `async/await`,
  forcing a microtask queue round-trip on every request even for synchronous stores.
- **No runtime validation:** express-rate-limit runs 9+ validation checks per request (`validations.ip`, `validations.trustProxy`, `validations.xForwardedForHeader`, `validations.forwardedHeader`, `validations.positiveHits`, `validations.singleCount`, `validations.limit`,
  `validations.headersResetTime`, `validations.disable`). universal-rate-limit has zero per-request validation.
- **No `Object.defineProperty`:** express-rate-limit uses `Object.defineProperty` to attach `current` to the rate limit info object on every request — a slow operation. universal-rate-limit skips this entirely.
- **No `WeakMap` lookups:** express-rate-limit maintains a `WeakMap<Request, Map>` (`singleCountKeys`) to ensure each key is only incremented once per request, adding a WeakMap lookup on every request.
- **Configuration resolved once:** All config (limit, window, key generator) is resolved at creation time. express-rate-limit re-evaluates some config per-request (skip function, async key generator, limit function).

---

## 3. Raw MemoryStore Performance

Isolates the store's `increment()` method from all middleware logic.

```
MemoryStore.increment() Benchmark
======================================================================
Operations: 500,000 | Warmup: 50,000 | Keys: 1000

Results:
----------------------------------------------------------------------
Store                                         ops/sec   avg (ns)   total (ms)
----------------------------------------------------------------------
universal-rate-limit MemoryStore           12,482,615         80         40.1
express-rate-limit MemoryStore             11,361,076         88         44.0
universal MemoryStore (sliding window)     11,611,671         86         43.1
----------------------------------------------------------------------
```

**How measured:** `pnpm bench:store` — direct calls to `store.increment(key)` with string keys from a pool of 1,000. No request objects, no middleware, no headers.

**Note:** Raw store performance is essentially at parity between the two libraries (~10% difference, within run-to-run variance). In some runs express-rate-limit's store is marginally faster due to its simpler resetTime check (`resetTime <= now`) vs universal-rate-limit's window
boundary computation (`Math.floor(now / windowMs) * windowMs`). The middleware layer is where the significant performance difference emerges — see Section 2.

---

## 4. Memory Usage

Measures heap consumption after populating the store with 100,000 unique keys.

```
Memory Usage Benchmark
============================================================
Keys: 100,000 | Window: 60000ms

Results:
------------------------------------------------------------
Store                                    Total      Per Key
------------------------------------------------------------
universal-rate-limit MemoryStore      21.76 MB  228.12 B
express-rate-limit MemoryStore        19.73 MB  206.88 B
------------------------------------------------------------
```

**How measured:** `pnpm bench:memory` — run with `node --expose-gc`. Forced GC before and after populating the store, measured `process.memoryUsage().heapUsed` delta.

### Why it uses more memory

universal-rate-limit's MemoryStore uses **~10% more memory per key** than express-rate-limit. This is because:

- universal-rate-limit stores three fields per entry: `{ hits: number, resetTime: number, resetDate: Date }` — both a numeric timestamp (used for fast window boundary math) and a cached `Date` object (returned in the `IncrementResult` to avoid allocating a new Date on every
  request)
- express-rate-limit stores two fields: `{ totalHits: number, resetTime: Date }` — a single Date object per key
- universal-rate-limit also maintains two internal Maps (`current` and `previous`) to support the sliding window algorithm, even when running in fixed-window mode. This adds Map overhead for keys that span a window rotation.

This is a deliberate trade-off: the extra `resetTime` number enables the fast `Math.floor` window alignment that underpins fixed-window correctness, and the dual-map structure is required for sliding-window support. The ~21 bytes/key cost is small compared to the 2.5x middleware
throughput gain.

---

## 5. Real HTTP Server Throughput

Full end-to-end test with actual Express servers and HTTP requests via `fetch()`.

```
Express Middleware HTTP Benchmark
======================================================================
Requests: 10,000 | Warmup: 3,000 | Rounds: 3

Per-round details:
----------------------------------------------------------------------
Round    Library                                req/sec   avg (ms)
----------------------------------------------------------------------
1        @universal-rate-limit/express           14,916      0.067
         express-rate-limit                      15,605      0.064
2        @universal-rate-limit/express           16,155      0.062
         express-rate-limit                      16,057      0.062
3        @universal-rate-limit/express           16,327      0.061
         express-rate-limit                      16,157      0.062

Median results:
----------------------------------------------------------------------
Library                                req/sec
----------------------------------------------------------------------
@universal-rate-limit/express           16,155
express-rate-limit                      16,057
----------------------------------------------------------------------
```

**How measured:** `pnpm bench:http` — two Express servers on localhost, sequential `fetch()` requests. Each request goes through the full Express pipeline, rate limiter, and response.

**Note:** In real HTTP benchmarks, the rate limiter accounts for a tiny fraction of total request time. The ~1% difference here is within noise range and dominated by Express routing, TCP/HTTP overhead, and `fetch()` latency. Both libraries add negligible overhead to real HTTP
traffic. The synthetic middleware benchmark (Section 2) is a better measure of the rate limiter's own performance.

---

## 6. Feature Comparison

| Feature                                         | @universal-rate-limit/express   | express-rate-limit                                           |
| ----------------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| Algorithms                                      | Fixed window, sliding window    | Fixed window only                                            |
| Header drafts                                   | draft-6, draft-7                | draft-6, draft-7, draft-8                                    |
| Legacy `X-RateLimit-*` headers                  | Yes                             | Yes                                                          |
| IPv6 subnet normalization                       | No (user key generator)         | Built-in (`ip-address` dep)                                  |
| Runtime option validation                       | No                              | Yes (extensive)                                              |
| `skipFailedRequests` / `skipSuccessfulRequests` | No                              | Yes                                                          |
| `requestPropertyName` (attach info to req)      | No                              | Yes                                                          |
| Framework support                               | Express, Fastify, Hono, Next.js | Express only                                                 |
| Runtime support                                 | Node.js, Deno, Bun, Edge        | Node.js only                                                 |
| Custom store interface                          | Minimal (4 methods)             | Larger (init, get, increment, decrement, resetKey, resetAll) |

---

## How to Reproduce

```bash
# From the repo root:
pnpm -r run build
cd packages/benchmarks

# Throughput (middleware-level, no HTTP)
pnpm bench:throughput

# Raw store performance
pnpm bench:store

# Memory usage (requires --expose-gc)
pnpm bench:memory

# Real HTTP server throughput
pnpm bench:http

# Run all benchmarks
pnpm bench
```

All benchmarks are single-threaded, single-process, and use in-memory stores. Results will vary by hardware and Node.js version.
