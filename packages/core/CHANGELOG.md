# universal-rate-limit

## 2.1.0

### Minor Changes

- [#11](https://github.com/KKonstantinov/universal-rate-limit/pull/11) [`46ccbb5`](https://github.com/KKonstantinov/universal-rate-limit/commit/46ccbb5fd47b28e0b9a9f14958b71e1a229ccae6) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - Remove `bucketSize` from
  `AlgorithmConfig` and `tokenBucket()` factory. Bucket capacity is now always controlled by the top-level `limit` option, making it the single source of truth for capacity across all algorithms. This fixes a bug where headers could report a different limit than what the
  algorithm actually enforced.

    **Migration:** Replace `{ type: 'token-bucket', refillRate: 10, bucketSize: 50 }` with `{ type: 'token-bucket', refillRate: 10 }` and set `limit: 50` on the top-level options.

## 2.0.2

### Patch Changes

- [`5b3a3d7`](https://github.com/KKonstantinov/universal-rate-limit/commit/5b3a3d758e195e33e1ee56aa2f376439a7a3230b) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - docs update

## 2.0.1

### Patch Changes

- [`82d1c2c`](https://github.com/KKonstantinov/universal-rate-limit/commit/82d1c2c3a16983ea937c13c4ba1be205dc12941a) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - X-RateLimit-Reset fix, docs update

## 2.0.0

### Major Changes

- [#8](https://github.com/KKonstantinov/universal-rate-limit/pull/8) [`24eedb1`](https://github.com/KKonstantinov/universal-rate-limit/commit/24eedb16cc076a316d26669a37b528944bb024e0) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - BREAKING CHANGE: Default algorithm
  changed from `fixed-window` to `sliding-window`.

    The `rateLimit()` function now defaults to the `sliding-window` algorithm, which provides smoother rate limiting by weighting the previous window's hits. To preserve the previous behavior, explicitly pass `algorithm: 'fixed-window'`:

    ```ts
    const limiter = rateLimit({
        algorithm: 'fixed-window'
        // ...other options
    });
    ```

## 1.1.0

### Minor Changes

- [`c393ec8`](https://github.com/KKonstantinov/universal-rate-limit/commit/c393ec887474bce475c3aeba138f32ea5be58e78) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - add Retry-After header support

## 1.0.0

### Major Changes

- [#3](https://github.com/KKonstantinov/universal-rate-limit/pull/3) [`900aacf`](https://github.com/KKonstantinov/universal-rate-limit/commit/900aacffe68bdc6223225e2eddf0f4ca939ee2af) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - first major, version bump
