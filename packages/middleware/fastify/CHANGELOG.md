# @universal-rate-limit/fastify

## 2.0.4

### Patch Changes

- [#13](https://github.com/KKonstantinov/universal-rate-limit/pull/13) [`8432f1e`](https://github.com/KKonstantinov/universal-rate-limit/commit/8432f1eb51cc3145bde287d786edcb734b31b889) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - migrate docs

- Updated dependencies [[`8432f1e`](https://github.com/KKonstantinov/universal-rate-limit/commit/8432f1eb51cc3145bde287d786edcb734b31b889)]:
    - universal-rate-limit@2.1.1

## 2.0.3

### Patch Changes

- Updated dependencies [[`46ccbb5`](https://github.com/KKonstantinov/universal-rate-limit/commit/46ccbb5fd47b28e0b9a9f14958b71e1a229ccae6)]:
    - universal-rate-limit@2.1.0

## 2.0.2

### Patch Changes

- [`5b3a3d7`](https://github.com/KKonstantinov/universal-rate-limit/commit/5b3a3d758e195e33e1ee56aa2f376439a7a3230b) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - docs update

- Updated dependencies [[`5b3a3d7`](https://github.com/KKonstantinov/universal-rate-limit/commit/5b3a3d758e195e33e1ee56aa2f376439a7a3230b)]:
    - universal-rate-limit@2.0.2

## 2.0.1

### Patch Changes

- [`82d1c2c`](https://github.com/KKonstantinov/universal-rate-limit/commit/82d1c2c3a16983ea937c13c4ba1be205dc12941a) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - X-RateLimit-Reset fix, docs update

- Updated dependencies [[`82d1c2c`](https://github.com/KKonstantinov/universal-rate-limit/commit/82d1c2c3a16983ea937c13c4ba1be205dc12941a)]:
    - universal-rate-limit@2.0.1

## 2.0.0

### Major Changes

- [#8](https://github.com/KKonstantinov/universal-rate-limit/pull/8) [`24eedb1`](https://github.com/KKonstantinov/universal-rate-limit/commit/24eedb16cc076a316d26669a37b528944bb024e0) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - BREAKING CHANGE: Algorithm/store
  separation and new `Store` interface.

    The core library now separates algorithms (`fixedWindow`, `slidingWindow`, `tokenBucket`) from stores (`MemoryStore`, `RedisStore`). The `Store` interface changed from `increment()`/`decrement()` to `consume()`/`peek()`/`unconsume()`, accepting an `Algorithm` instance.

    All middleware packages and the Redis store have been updated to work with the new architecture. Existing `store` configurations using the old `Store` interface will need to be updated.

### Patch Changes

- Updated dependencies [[`24eedb1`](https://github.com/KKonstantinov/universal-rate-limit/commit/24eedb16cc076a316d26669a37b528944bb024e0)]:
    - universal-rate-limit@2.0.0

## 1.1.0

### Minor Changes

- [`c393ec8`](https://github.com/KKonstantinov/universal-rate-limit/commit/c393ec887474bce475c3aeba138f32ea5be58e78) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - add Retry-After header support

### Patch Changes

- Updated dependencies [[`c393ec8`](https://github.com/KKonstantinov/universal-rate-limit/commit/c393ec887474bce475c3aeba138f32ea5be58e78)]:
    - universal-rate-limit@1.1.0

## 1.0.0

### Major Changes

- [#3](https://github.com/KKonstantinov/universal-rate-limit/pull/3) [`900aacf`](https://github.com/KKonstantinov/universal-rate-limit/commit/900aacffe68bdc6223225e2eddf0f4ca939ee2af) Thanks [@KKonstantinov](https://github.com/KKonstantinov)! - first major, version bump

### Patch Changes

- Updated dependencies [[`900aacf`](https://github.com/KKonstantinov/universal-rate-limit/commit/900aacffe68bdc6223225e2eddf0f4ca939ee2af)]:
    - universal-rate-limit@1.0.0
