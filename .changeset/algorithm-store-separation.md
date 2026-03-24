---
'@universal-rate-limit/redis': major
'@universal-rate-limit/express': major
'@universal-rate-limit/fastify': major
'@universal-rate-limit/hono': major
'@universal-rate-limit/nextjs': major
---

BREAKING CHANGE: Algorithm/store separation and new `Store` interface.

The core library now separates algorithms (`fixedWindow`, `slidingWindow`, `tokenBucket`) from stores (`MemoryStore`, `RedisStore`). The `Store` interface changed from `increment()`/`decrement()` to `consume()`/`peek()`/`unconsume()`, accepting an `Algorithm` instance.

All middleware packages and the Redis store have been updated to work with the new architecture. Existing `store` configurations using the old `Store` interface will need to be updated.
