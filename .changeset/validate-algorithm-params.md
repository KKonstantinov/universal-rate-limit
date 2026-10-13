---
'universal-rate-limit': patch
---

`rateLimit()` now throws a `RangeError` when `windowMs`, `refillRate` or `refillMs` is missing or `NaN`, not only when it is zero or negative. Untyped configs such as `{ type: 'token-bucket' }` previously produced a limiter that silently misbehaved.
