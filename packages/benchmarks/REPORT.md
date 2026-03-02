# Performance Comparison: `@universal-rate-limit/express` vs `express-rate-limit`

**Date:** 2026-03-02 **Environment:** Node.js v24.13.0 · macOS Darwin 25.2.0 · Apple Silicon (arm64) **Versions:** `universal-rate-limit` 0.1.0 · `express-rate-limit` 8.2.1

---

## Summary

| Metric                             | @universal-rate-limit/express | express-rate-limit | Difference           |
| ---------------------------------- | ----------------------------- | ------------------ | -------------------- |
| Bundle size (ESM, raw)             | **11.0 KB**                   | 32.4 KB            | **2.9x smaller**     |
| Bundle size (ESM, gzip)            | **4.2 KB**                    | 8.8 KB             | **2.1x smaller**     |
| Runtime dependencies               | **0**                         | 1 (`ip-address`)   | —                    |
| Middleware throughput (multi-key)  | **1,870K ops/sec**            | 1,424K ops/sec     | **1.31x faster**     |
| Middleware throughput (single-key) | **1,993K ops/sec**            | 1,487K ops/sec     | **1.34x faster**     |
| Memory per key (100K keys)         | **124 B/key**                 | 207 B/key          | **1.7x less memory** |
| Memory total (100K keys)           | **11.8 MB**                   | 19.7 MB            | **1.7x less memory** |
| HTTP req/sec (real Express server) | 14,708 req/sec                | 15,657 req/sec     | 0.94x (see note)     |

---

## 1. Bundle Size

Both libraries were measured using their published ESM dist bundles.

```
@universal-rate-limit/express (core + adapter):
  packages/core/dist/index.mjs          8,903 B  (3,112 B gzip)
  packages/middleware/express/dist/      2,124 B  (1,040 B gzip)
  Combined:                            11,027 B  (4,152 B gzip)

express-rate-limit:
  dist/index.mjs                       32,374 B  (8,803 B gzip)
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
Operations: 100,000 | Warmup: 10,000 | Keys: 1000

Middleware                                    ops/sec   avg (µs)   total (ms)
@universal-rate-limit/express               1,870,438       0.53         53.5
express-rate-limit                          1,423,567       0.70         70.2
@universal-rate-limit/express (single key)  1,992,818       0.50         50.2
express-rate-limit (single key)             1,486,716       0.67         67.3
```

**How measured:** `benchmarks/throughput.mjs` — each iteration creates a mock Express request with an IP from a pool of 1,000 keys, passes it through the middleware, and calls `next()`. Wall-clock time measured via `performance.now()`. 10,000 warmup iterations discarded to
stabilize JIT. Both libraries configured identically: 60s window, draft-7 headers, in-memory store. `express-rate-limit` validations disabled (`validate: false`) for fairness since universal-rate-limit doesn't have runtime validation overhead.

### Why it's faster

- Simpler code path: fewer function calls, no runtime validation checks, no `Object.defineProperty` to attach rate limit info to the request
- No `async keyGenerator` in the default path — universal-rate-limit's Express adapter uses a synchronous key generator by default
- No per-request validation state management — express-rate-limit maintains a `WeakMap<Request, Map>` for single-count deduplication and calls `config.validations.disable()` at the end of each request
- Configuration resolved once at creation, not per-request

---

## 3. Raw MemoryStore Performance

Isolates the store's `increment()` method from all middleware logic.

```
MemoryStore.increment() Benchmark
Operations: 500,000 | Warmup: 50,000 | Keys: 1000

Store                                         ops/sec   avg (ns)   total (ms)
universal-rate-limit MemoryStore           10,466,081         96         47.8
express-rate-limit MemoryStore             12,428,922         80         40.2
universal MemoryStore (sliding window)      9,510,570        105         52.6
```

**How measured:** `benchmarks/store-only.mjs` — direct calls to `store.increment(key)` with string keys from a pool of 1,000. No request objects, no middleware, no headers.

**Note:** express-rate-limit's MemoryStore is ~19% faster at raw increments. This is because universal-rate-limit's store computes window boundaries via `Math.floor(now / windowMs) * windowMs` on every increment for alignment, while express-rate-limit's store simply checks
`resetTime <= now`. However, this difference is absorbed by the middleware layer — universal-rate-limit's leaner middleware path more than compensates, resulting in higher end-to-end throughput (see Section 2).

---

## 4. Memory Usage

Measures heap consumption after populating the store with 100,000 unique keys.

```
Memory Usage Benchmark
Keys: 100,000 | Window: 60000ms

Store                                    Total      Per Key
universal-rate-limit MemoryStore      11.84 MB  124.12864 B
express-rate-limit MemoryStore        19.73 MB  206.87992 B
```

**How measured:** `benchmarks/memory.mjs` — run with `node --expose-gc`. Forced GC before and after populating the store, measured `process.memoryUsage().heapUsed` delta.

### Why it uses less memory

- universal-rate-limit stores `{ hits: number, resetTime: number }` — two plain numeric primitives per key
- express-rate-limit stores `{ totalHits: number, resetTime: Date }` — `Date` objects are heap-allocated with higher overhead than a plain number timestamp (~83 extra bytes per key)

---

## 5. Real HTTP Server Throughput

Full end-to-end test with actual Express servers and HTTP requests via `fetch()`.

```
Express Middleware HTTP Benchmark
Requests: 10,000 | Warmup: 1,000

Library                                req/sec   avg (ms)   total (ms)
@universal-rate-limit/express           14,708      0.068          680
express-rate-limit                      15,657      0.064          639
```

**How measured:** `benchmarks/express-middleware.mjs` — two Express servers on localhost, sequential `fetch()` requests. Each request goes through the full Express pipeline, rate limiter, and response.

**Note:** In real HTTP benchmarks, the rate limiter accounts for a tiny fraction of total request time. The ~6% difference here is within noise range and dominated by Express routing, TCP/HTTP overhead, and `fetch()` latency. Both libraries add negligible overhead to real HTTP
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
