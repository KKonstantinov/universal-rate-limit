---
'@universal-rate-limit/express': minor
'@universal-rate-limit/fastify': minor
---

**Security fix:** the default key is now the framework's `req.ip`, which honours Express's `trust proxy` setting and Fastify's `trustProxy` option. Previously the adapters read `X-Forwarded-For` (and similar headers) before `req.ip`, so a client could rotate that header to get a
fresh limit on every request. Behind a reverse proxy, configure `trust proxy` / `trustProxy` so `req.ip` is the client; otherwise all clients share the proxy's IP. Apps that pass their own `keyGenerator` are unaffected.
