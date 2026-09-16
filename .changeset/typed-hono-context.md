---
'@universal-rate-limit/hono': minor
---

Pass typed Hono context as the final argument to rate-limit callbacks while preserving existing Request-based callbacks. Preserve custom refusal headers and binary or streaming bodies, and apply rate-limit headers to final downstream and error responses.
