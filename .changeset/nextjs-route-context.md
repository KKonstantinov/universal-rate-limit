---
'@universal-rate-limit/nextjs': minor
---

`withRateLimit` now forwards the Next.js route context to the wrapped handler, so dynamic routes (`app/api/users/[id]/route.ts`) receive their `params`. `NextjsApiHandler` takes an optional `TContext` type parameter.
