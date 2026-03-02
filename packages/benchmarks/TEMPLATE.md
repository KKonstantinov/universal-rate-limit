# Benchmark Report Template

> **This file is for LLMs (Claude, etc.) to produce a fresh `REPORT.md`.** See `REPORT.md` for the current published report as a reference example.

## How to use this template

### Step 1 — Build

```bash
pnpm -r run build
```

### Step 2 — Run all four benchmarks and capture stdout

```bash
cd packages/benchmarks
pnpm bench:throughput
pnpm bench:store
pnpm bench:memory
pnpm bench:http
```

### Step 3 — Measure bundle sizes

```bash
wc -c packages/core/dist/index.mjs
gzip -c packages/core/dist/index.mjs | wc -c
wc -c packages/middleware/express/dist/index.mjs
gzip -c packages/middleware/express/dist/index.mjs | wc -c
# For express-rate-limit, find its dist in node_modules:
wc -c node_modules/express-rate-limit/dist/index.cjs
gzip -c node_modules/express-rate-limit/dist/index.cjs | wc -c
```

### Step 4 — Collect environment info

```bash
node --version
uname -s -r
uname -m
# Read versions from packages/core/package.json and
# node_modules/express-rate-limit/package.json
```

### Step 5 — Generate the report

- Copy everything below the **--- TEMPLATE START ---** line.
- Replace every `{{PLACEHOLDER}}` with real data from steps 2-4.
- For `{{OUTPUT}}` placeholders, paste the full terminal output from each benchmark (everything the script prints to stdout).
- For `[REPLACE: ...]` markers, read the source code in `packages/core/src/` and `packages/middleware/express/src/` to write explanations of the architectural reasons. See `REPORT.md` for examples of good explanations.
- For the Feature Comparison table, check express-rate-limit's current README/docs for any feature changes since the last report.
- Write the result to `packages/benchmarks/REPORT.md`.

### Step 6 — Review the report

- Verify all numbers match the benchmark output.
- Verify the "Difference" column math is correct (e.g., 1,870K / 1,444K = 1.29x).
- Bold the winner in each row of the Summary table.
- If universal-rate-limit loses a metric, don't bold it — be honest.

## Notes

- Benchmarks are noisy. Run each at least twice and use representative numbers.
- The HTTP benchmark (`bench:http`) is dominated by Express/TCP overhead, not the rate limiter. Small differences there are noise — call this out.
- The store-only benchmark may show express-rate-limit winning. That's fine — explain that the middleware layer compensates (see Section 3 of `REPORT.md`).
- Don't fabricate numbers. If a benchmark wasn't run, leave it blank.

---

## --- TEMPLATE START ---

# Performance Comparison: `@universal-rate-limit/express` vs `express-rate-limit`

**Date:** {{DATE}} **Environment:** Node.js {{NODE_VERSION}} · {{OS}} · {{ARCH}} **Versions:** `universal-rate-limit` {{URL_VERSION}} · `express-rate-limit` {{ERL_VERSION}}

---

## Summary

| Metric                             | @universal-rate-limit/express         | express-rate-limit                       | Difference                              |
| ---------------------------------- | ------------------------------------- | ---------------------------------------- | --------------------------------------- |
| Bundle size (ESM, raw)             | **{{URL_BUNDLE_RAW}}**                | {{ERL_BUNDLE_RAW}}                       | **{{BUNDLE_RAW_RATIO}}x smaller**       |
| Bundle size (ESM, gzip)            | **{{URL_BUNDLE_GZIP}}**               | {{ERL_BUNDLE_GZIP}}                      | **{{BUNDLE_GZIP_RATIO}}x smaller**      |
| Runtime dependencies               | **0**                                 | {{ERL_DEPS_COUNT}} (`{{ERL_DEPS_LIST}}`) | —                                       |
| Middleware throughput (multi-key)  | **{{URL_THROUGHPUT_MULTI}} ops/sec**  | {{ERL_THROUGHPUT_MULTI}} ops/sec         | **{{THROUGHPUT_MULTI_RATIO}}x faster**  |
| Middleware throughput (single-key) | **{{URL_THROUGHPUT_SINGLE}} ops/sec** | {{ERL_THROUGHPUT_SINGLE}} ops/sec        | **{{THROUGHPUT_SINGLE_RATIO}}x faster** |
| Memory per key (100K keys)         | **{{URL_MEM_PER_KEY}}**               | {{ERL_MEM_PER_KEY}}                      | **{{MEM_PER_KEY_RATIO}}x less memory**  |
| Memory total (100K keys)           | **{{URL_MEM_TOTAL}}**                 | {{ERL_MEM_TOTAL}}                        | **{{MEM_TOTAL_RATIO}}x less memory**    |
| HTTP req/sec (real Express server) | {{URL_HTTP_RPS}} req/sec              | {{ERL_HTTP_RPS}} req/sec                 | {{HTTP_RPS_NOTE}}                       |

---

## 1. Bundle Size

Both libraries were measured using their published ESM dist bundles.

```
@universal-rate-limit/express (core + adapter):
  packages/core/dist/index.mjs          {{CORE_SIZE_RAW}}  ({{CORE_SIZE_GZIP}} gzip)
  packages/middleware/express/dist/      {{EXPRESS_ADAPTER_SIZE_RAW}}  ({{EXPRESS_ADAPTER_SIZE_GZIP}} gzip)
  Combined:                             {{URL_BUNDLE_RAW}}  ({{URL_BUNDLE_GZIP}} gzip)

express-rate-limit:
  dist/index.mjs                        {{ERL_BUNDLE_RAW}}  ({{ERL_BUNDLE_GZIP}} gzip)
```

**How measured:** Raw byte count of built `.mjs` files via `wc -c`, gzip via `gzip -c | wc -c`.

[REPLACE: Mention runtime dep footprint (ip-address, etc.) if still relevant.]

### Why it's smaller

[REPLACE: Read packages/core/src/ and compare against express-rate-limit source. Typical reasons: no validation framework, no legacy store compat, no node:crypto imports, IPv6 deferred to user key generator.]

---

## 2. Middleware Throughput

Both libraries were tested as Express middleware using identical mock `req`/`res`/`next` objects in a tight async loop. No HTTP server or network involved — this isolates the middleware logic.

```
{{THROUGHPUT_OUTPUT}}
```

**How measured:** `pnpm bench:throughput` — each iteration creates a mock Express request with an IP from a pool of 1,000 keys, passes it through the middleware, and calls `next()`. Wall-clock time measured via `performance.now()`. 10,000 warmup iterations discarded to stabilize
JIT. Both libraries configured identically: 60s window, in-memory store. `express-rate-limit` validations disabled (`validate: false`) for fairness.

### Why it's faster

[REPLACE: Typical reasons: simpler code path, no runtime validation, no Object.defineProperty, synchronous key generator, config resolved once at creation not per-request.]

---

## 3. Raw MemoryStore Performance

Isolates the store's `increment()` method from all middleware logic.

```
{{STORE_OUTPUT}}
```

**How measured:** `pnpm bench:store` — direct calls to `store.increment(key)` with string keys from a pool of 1,000. No request objects, no middleware, no headers.

[REPLACE: express-rate-limit's store may be faster here. If so, explain why (simpler resetTime check vs. window boundary computation) and note that the middleware layer compensates — see Section 2 throughput results.]

---

## 4. Memory Usage

Measures heap consumption after populating the store with 100,000 unique keys.

```
{{MEMORY_OUTPUT}}
```

**How measured:** `pnpm bench:memory` — run with `node --expose-gc`. Forced GC before and after populating the store, measured `process.memoryUsage().heapUsed` delta.

### Why it uses less memory

[REPLACE: Typical reason: universal-rate-limit stores two plain numbers { hits, resetTime } while express-rate-limit uses a Date object for resetTime which has higher heap overhead.]

---

## 5. Real HTTP Server Throughput

Full end-to-end test with actual Express servers and HTTP requests via `fetch()`.

```
{{HTTP_OUTPUT}}
```

**How measured:** `pnpm bench:http` — two Express servers on localhost, sequential `fetch()` requests. Each request goes through the full Express pipeline, rate limiter, and response.

**Note:** In real HTTP benchmarks, the rate limiter accounts for a tiny fraction of total request time. Differences here are within noise range and dominated by Express routing, TCP/HTTP overhead, and `fetch()` latency. The synthetic middleware benchmark (Section 2) is a better
measure of the rate limiter's own performance.

---

## 6. Feature Comparison

| Feature                                         | @universal-rate-limit/express   | express-rate-limit                                           |
| ----------------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| Algorithms                                      | Fixed window, sliding window    | Fixed window only                                            |
| Header drafts                                   | draft-6, draft-7                | draft-6, draft-7, draft-8                                    |
| Legacy `X-RateLimit-*` headers                  | No                              | Yes                                                          |
| IPv6 subnet normalization                       | No (user key generator)         | Built-in (`ip-address` dep)                                  |
| Runtime option validation                       | No                              | Yes (extensive)                                              |
| `skipFailedRequests` / `skipSuccessfulRequests` | No                              | Yes                                                          |
| Framework support                               | Express, Fastify, Hono, Next.js | Express only                                                 |
| Runtime support                                 | Node.js, Deno, Bun, Edge        | Node.js only                                                 |
| Custom store interface                          | Minimal (4 methods)             | Larger (init, get, increment, decrement, resetKey, resetAll) |

[REPLACE: Check express-rate-limit's latest README for any feature changes.]

---

## How to Reproduce

```bash
pnpm -r run build
cd packages/benchmarks

pnpm bench:throughput
pnpm bench:store
pnpm bench:memory
pnpm bench:http
```

All benchmarks are single-threaded, single-process, and use in-memory stores. Results will vary by hardware and Node.js version.
