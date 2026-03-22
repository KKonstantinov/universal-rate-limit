---
'universal-rate-limit': major
---

BREAKING CHANGE: Default algorithm changed from `fixed-window` to `sliding-window`.

The `rateLimit()` function now defaults to the `sliding-window` algorithm, which provides smoother rate limiting by weighting the previous window's hits. To preserve the previous behavior, explicitly pass `algorithm: 'fixed-window'`:

```ts
const limiter = rateLimit({
    algorithm: 'fixed-window'
    // ...other options
});
```
