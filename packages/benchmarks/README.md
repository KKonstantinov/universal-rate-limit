# @universal-rate-limit/benchmarks

Performance benchmarks comparing `universal-rate-limit` against `express-rate-limit`.

## Benchmarks

| Script             | What it measures                                       |
| ------------------ | ------------------------------------------------------ |
| `bench:throughput` | Middleware ops/sec with mock Express req/res (no HTTP) |
| `bench:store`      | Raw `MemoryStore.increment()` performance              |
| `bench:memory`     | Heap usage per key (requires `--expose-gc`)            |
| `bench:http`       | Real HTTP req/sec through Express servers              |

## Running

```bash
# Build all workspace packages first
pnpm -r run build

# Run all benchmarks
cd packages/benchmarks
pnpm bench

# Or run individually
pnpm bench:throughput
pnpm bench:store
pnpm bench:memory
pnpm bench:http
```

## Results

See [REPORT.md](./REPORT.md) for the latest results and analysis.

## Adding a new benchmark

1. Create a new `.ts` file in `src/`.
2. Add the entry to `tsdown.config.ts`.
3. Add a corresponding `bench:*` script to `package.json`.
4. Run `pnpm build` then `node dist/<name>.mjs` to verify.
