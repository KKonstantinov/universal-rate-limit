---
'@universal-rate-limit/redis': patch
---

Use Redis server time for shared token-bucket refill, preserve monotonic accounting through clock rollback, and return clock-skew-safe retry and reset durations.
