---
'@universal-rate-limit/redis': patch
---

Reject token-bucket requests whose cost exceeds a new bucket's capacity, including zero-capacity buckets. Rejected requests preserve available tokens across repeated and concurrent calls.
