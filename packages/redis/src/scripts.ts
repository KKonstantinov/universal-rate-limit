// ── Lua Scripts ─────────────────────────────────────────────────────────────
// Atomic Redis operations for rate limiting, organized by algorithm.

// ── Fixed Window ─────────────────────────────────────────────────────────────

/**
 * Fixed window consume script.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = windowMs (TTL in milliseconds)
 * ARGV[2] = limit
 * ARGV[3] = nowMs (current time in milliseconds)
 * ARGV[4] = resetExpiryOnChange ("1" or "0")
 * ARGV[5] = cost (units to consume, default 1)
 *
 * Returns: { limited (0 or 1), remaining, resetTime (absolute ms), retryAfterMs }
 * as a four-element array.
 */
export const FIXED_WINDOW_CONSUME = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local resetExpiry = ARGV[4] == "1"
local cost = tonumber(ARGV[5]) or 1

local ttl = redis.call("PTTL", key)
local hits
local resetTime

if ttl <= 0 then
    redis.call("SET", key, cost, "PX", windowMs)
    hits = cost
    resetTime = nowMs + windowMs
else
    hits = redis.call("INCRBY", key, cost)
    if resetExpiry then
        redis.call("PEXPIRE", key, windowMs)
        resetTime = nowMs + windowMs
    else
        resetTime = nowMs + ttl
    end
end

local limited = hits > limit and 1 or 0
local remaining = math.max(0, limit - hits)
local retryAfterMs = 0
if limited == 1 then
    retryAfterMs = math.max(0, resetTime - nowMs)
end

return {limited, remaining, resetTime, retryAfterMs}
`;

/**
 * Fixed window peek script.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = limit
 * ARGV[2] = nowMs
 *
 * Returns: { limited (0 or 1), remaining, resetTime, retryAfterMs } as a four-element array.
 * If the key doesn't exist, returns {-1}.
 */
export const FIXED_WINDOW_PEEK = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local nowMs = tonumber(ARGV[2])

local value = redis.call("GET", key)

if value == false then
    return {-1}
end

local hits = tonumber(value)
local ttl = redis.call("PTTL", key)
local resetTime = nowMs + (ttl > 0 and ttl or 0)
local limited = hits > limit and 1 or 0
local remaining = math.max(0, limit - hits)
local retryAfterMs = 0
if limited == 1 then
    retryAfterMs = math.max(0, resetTime - nowMs)
end

return {limited, remaining, resetTime, retryAfterMs}
`;

// ── Sliding Window ───────────────────────────────────────────────────────────

/**
 * Sliding window consume script.
 *
 * KEYS[1] = rate limit key (used as a Redis hash)
 * ARGV[1] = windowMs
 * ARGV[2] = limit
 * ARGV[3] = nowMs (current time in milliseconds)
 * ARGV[4] = cost (units to consume, default 1)
 *
 * Hash fields: curr, prev, windowStart
 *
 * Returns: { limited (0 or 1), remaining, resetTime (absolute ms), retryAfterMs }
 * as a four-element array.
 */
export const SLIDING_WINDOW_CONSUME = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4]) or 1

local windowStart = tonumber(redis.call("HGET", key, "windowStart") or "0")
local curr = tonumber(redis.call("HGET", key, "curr") or "0")
local prev = tonumber(redis.call("HGET", key, "prev") or "0")

if windowStart == 0 then
    redis.call("HMSET", key, "curr", cost, "prev", 0, "windowStart", nowMs)
    redis.call("PEXPIRE", key, windowMs * 2)
    curr = cost
    prev = 0
    windowStart = nowMs
elseif nowMs >= windowStart + windowMs * 2 then
    redis.call("HMSET", key, "curr", cost, "prev", 0, "windowStart", nowMs)
    redis.call("PEXPIRE", key, windowMs * 2)
    curr = cost
    prev = 0
    windowStart = nowMs
elseif nowMs >= windowStart + windowMs then
    local newWindowStart = windowStart + windowMs
    prev = curr
    curr = cost
    windowStart = newWindowStart
    redis.call("HMSET", key, "prev", prev, "curr", curr, "windowStart", windowStart)
    redis.call("PEXPIRE", key, windowMs * 2)
else
    curr = redis.call("HINCRBY", key, "curr", cost)
    redis.call("PEXPIRE", key, windowMs * 2)
end

local elapsed = nowMs - windowStart
local weight = math.max(0, 1 - elapsed / windowMs)
local totalHits = math.ceil(prev * weight + curr)
local limited = totalHits > limit and 1 or 0
local remaining = math.max(0, limit - totalHits)
local resetTime = windowStart + windowMs

local retryAfterMs = 0
if limited == 1 then
    retryAfterMs = math.max(0, resetTime - nowMs)
end

return {limited, remaining, resetTime, retryAfterMs}
`;

/**
 * Sliding window peek script.
 *
 * KEYS[1] = rate limit key (hash)
 * ARGV[1] = windowMs
 * ARGV[2] = limit
 * ARGV[3] = nowMs
 *
 * Returns: { limited (0 or 1), remaining, resetTime, retryAfterMs } as a four-element array.
 * If the key doesn't exist, returns {-1}.
 */
export const SLIDING_WINDOW_PEEK = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])

local windowStart = tonumber(redis.call("HGET", key, "windowStart") or "0")

if windowStart == 0 then
    return {-1}
end

local curr = tonumber(redis.call("HGET", key, "curr") or "0")
local prev = tonumber(redis.call("HGET", key, "prev") or "0")

if nowMs >= windowStart + windowMs * 2 then
    curr = 0
    prev = 0
    windowStart = nowMs
elseif nowMs >= windowStart + windowMs then
    prev = curr
    curr = 0
    windowStart = windowStart + windowMs
end

local elapsed = nowMs - windowStart
local weight = math.max(0, 1 - elapsed / windowMs)
local totalHits = math.ceil(prev * weight + curr)
local remaining = math.max(0, limit - totalHits)
local resetTime = windowStart + windowMs

return {0, remaining, resetTime, 0}
`;

// ── Token Bucket ─────────────────────────────────────────────────────────────

/**
 * Token bucket consume script.
 *
 * KEYS[1] = rate limit key (hash)
 * ARGV[1] = refillRate (tokens per refillMs interval)
 * ARGV[2] = capacity (bucket size — may differ from rate limit)
 * ARGV[3] = nowMs (current time in milliseconds)
 * ARGV[4] = cost (tokens to consume, default 1)
 * ARGV[5] = refillMs (refill interval in milliseconds, default 1000)
 *
 * Hash fields: tokens (stored as string with decimal), lastRefillMs
 *
 * Returns: { limited (0 or 1), remaining, resetTime (absolute ms), retryAfterMs }
 * as a four-element array.
 */
export const TOKEN_BUCKET_CONSUME = `
local key = KEYS[1]
local refillRate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4]) or 1
local refillMs = tonumber(ARGV[5]) or 1000
local tokensPerMs = refillRate / refillMs

local tokensStr = redis.call("HGET", key, "tokens")
local lastRefillStr = redis.call("HGET", key, "lastRefillMs")

local tokens
local limited

if tokensStr == false then
    -- First request: bucket starts full, deduct cost
    tokens = capacity - cost
    limited = 0
else
    local lastRefillMs = tonumber(lastRefillStr)
    local elapsed = nowMs - lastRefillMs
    local refilled = elapsed * tokensPerMs
    tokens = math.min(capacity, tonumber(tokensStr) + refilled)

    if tokens >= cost then
        tokens = tokens - cost
        limited = 0
    else
        limited = 1
    end
end

redis.call("HMSET", key, "tokens", tostring(tokens), "lastRefillMs", tostring(nowMs))

-- TTL: time to refill an empty bucket to full
local ttlMs = math.ceil(capacity / tokensPerMs)
redis.call("PEXPIRE", key, ttlMs)

local remaining
local resetTime = nowMs + math.ceil((capacity - tokens) / tokensPerMs)
local retryAfterMs = 0
if limited == 1 then
    remaining = 0
    retryAfterMs = math.ceil((cost - tokens) / tokensPerMs)
else
    remaining = math.max(0, math.floor(tokens))
end

return {limited, remaining, resetTime, retryAfterMs}
`;

/**
 * Token bucket peek script.
 *
 * KEYS[1] = rate limit key (hash)
 * ARGV[1] = refillRate
 * ARGV[2] = capacity (bucket size)
 * ARGV[3] = nowMs
 * ARGV[4] = refillMs (refill interval in milliseconds, default 1000)
 *
 * Returns: { limited (0 or 1), remaining, resetTime (absolute ms), retryAfterMs }
 * as a four-element array. If the key doesn't exist, returns {-1}.
 */
export const TOKEN_BUCKET_PEEK = `
local key = KEYS[1]
local refillRate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local refillMs = tonumber(ARGV[4]) or 1000
local tokensPerMs = refillRate / refillMs

local tokensStr = redis.call("HGET", key, "tokens")

if tokensStr == false then
    return {-1}
end

local lastRefillMs = tonumber(redis.call("HGET", key, "lastRefillMs"))
local elapsed = nowMs - lastRefillMs
local refilled = elapsed * tokensPerMs
local tokens = math.min(capacity, tonumber(tokensStr) + refilled)

local limited = tokens < 1 and 1 or 0
local remaining = math.max(0, math.floor(tokens))
local resetTime = nowMs + math.ceil((capacity - tokens) / tokensPerMs)
local retryAfterMs = 0
if limited == 1 then
    retryAfterMs = math.ceil((1 - tokens) / tokensPerMs)
end

return {limited, remaining, resetTime, retryAfterMs}
`;
