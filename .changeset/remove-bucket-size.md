---
'universal-rate-limit': minor
'@universal-rate-limit/redis': minor
---

Remove `bucketSize` from `AlgorithmConfig` and `tokenBucket()` factory. Bucket capacity is now always controlled by the top-level `limit` option, making it the single source of truth for capacity across all algorithms. This fixes a bug where headers could report a different limit
than what the algorithm actually enforced.

**Migration:** Replace `{ type: 'token-bucket', refillRate: 10, bucketSize: 50 }` with `{ type: 'token-bucket', refillRate: 10 }` and set `limit: 50` on the top-level options.
