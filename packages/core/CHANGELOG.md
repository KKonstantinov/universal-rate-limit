# universal-rate-limit

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
