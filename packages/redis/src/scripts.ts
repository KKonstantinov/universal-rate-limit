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
 * ARGV[4] = cost (units to consume, default 1)
 *
 * Returns: { limited (0 or 1), remaining, resetTime (absolute ms), retryAfterMs }
 * as a four-element array.
 */
export const FIXED_WINDOW_CONSUME = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4]) or 1

local ttl = redis.call("PTTL", key)
local hits
local resetTime

if ttl <= 0 then
    redis.call("SET", key, cost, "PX", windowMs)
    hits = cost
    resetTime = nowMs + windowMs
else
    hits = redis.call("INCRBY", key, cost)
    resetTime = nowMs + ttl
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
    local threshold = limit - 1 - curr
    if prev > 0 and threshold >= 0 then
        local targetWeight = threshold / prev
        if targetWeight >= 1 then
            retryAfterMs = 0
        else
            local targetElapsed = windowMs * (1 - targetWeight)
            retryAfterMs = math.max(0, windowStart + targetElapsed - nowMs)
        end
    else
        if curr == 0 then
            retryAfterMs = 0
        else
            local targetNewWeight = (limit - 1) / curr
            if targetNewWeight >= 1 then
                retryAfterMs = math.max(0, resetTime - nowMs)
            else
                local targetElapsedNew = windowMs * (1 - targetNewWeight)
                retryAfterMs = math.max(0, resetTime + targetElapsedNew - nowMs)
            end
        end
    end
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
 * ARGV[3] = cost (tokens to consume, default 1)
 * ARGV[4] = refillMs (refill interval in milliseconds, default 1000)
 *
 * Hash fields: tokens (stored as string with decimal), lastRefillMs
 *
 * Returns: { limited (0 or 1), remaining, resetAfterMs, retryAfterMs }
 * as a four-element array.
 */
export const TOKEN_BUCKET_CONSUME = `
local key = KEYS[1]
local refillRate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local cost = tonumber(ARGV[3]) or 1
local refillMs = tonumber(ARGV[4]) or 1000
local tokensPerMs = refillRate / refillMs
local authorityTime = redis.call("TIME")
local authorityNowMs = tonumber(authorityTime[1]) * 1000 + math.floor(tonumber(authorityTime[2]) / 1000)

local tokensStr = redis.call("HGET", key, "tokens")
local lastRefillStr = redis.call("HGET", key, "lastRefillMs")

local tokens
local limited
local lastRefillMs

if tokensStr == false then
    -- A new bucket has its full capacity, but the request must still fit.
    tokens = capacity
    lastRefillMs = authorityNowMs
else
    lastRefillMs = tonumber(lastRefillStr)
    local effectiveNowMs = math.max(authorityNowMs, lastRefillMs)
    local elapsed = effectiveNowMs - lastRefillMs
    local refilled = elapsed * tokensPerMs
    tokens = math.max(0, math.min(capacity, tonumber(tokensStr) + refilled))
    lastRefillMs = effectiveNowMs
end

if tokens >= cost then
    tokens = tokens - cost
    limited = 0
else
    -- Rejected requests leave available capacity intact.
    limited = 1
end

redis.call("HMSET", key, "tokens", tostring(tokens), "lastRefillMs", tostring(lastRefillMs))

-- Retain the bucket through any authority-clock rollback plus a full empty-to-full refill horizon.
local rollbackMs = math.max(0, lastRefillMs - authorityNowMs)
local ttlMs = rollbackMs + math.ceil(capacity / tokensPerMs)
redis.call("PEXPIRE", key, ttlMs)

local remaining
local resetAfterMs = rollbackMs + math.ceil((capacity - tokens) / tokensPerMs)
local retryAfterMs = 0
if limited == 1 then
    remaining = 0
    retryAfterMs = rollbackMs + math.ceil((cost - tokens) / tokensPerMs)
else
    remaining = math.max(0, math.floor(tokens))
end

return {limited, remaining, resetAfterMs, retryAfterMs}
`;

/**
 * Token bucket peek script.
 *
 * KEYS[1] = rate limit key (hash)
 * ARGV[1] = refillRate
 * ARGV[2] = capacity (bucket size)
 * ARGV[3] = refillMs (refill interval in milliseconds, default 1000)
 *
 * Returns: { limited (0 or 1), remaining, resetAfterMs, retryAfterMs }
 * as a four-element array. If the key doesn't exist, returns {-1}.
 */
export const TOKEN_BUCKET_PEEK = `
local key = KEYS[1]
local refillRate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillMs = tonumber(ARGV[3]) or 1000
local tokensPerMs = refillRate / refillMs
local authorityTime = redis.call("TIME")
local authorityNowMs = tonumber(authorityTime[1]) * 1000 + math.floor(tonumber(authorityTime[2]) / 1000)

local tokensStr = redis.call("HGET", key, "tokens")

if tokensStr == false then
    return {-1}
end

local lastRefillMs = tonumber(redis.call("HGET", key, "lastRefillMs"))
local effectiveNowMs = math.max(authorityNowMs, lastRefillMs)
local elapsed = effectiveNowMs - lastRefillMs
local refilled = elapsed * tokensPerMs
local tokens = math.max(0, math.min(capacity, tonumber(tokensStr) + refilled))
local rollbackMs = math.max(0, lastRefillMs - authorityNowMs)

local limited = tokens < 1 and 1 or 0
local remaining = math.max(0, math.floor(tokens))
local resetAfterMs = rollbackMs + math.ceil((capacity - tokens) / tokensPerMs)
local retryAfterMs = 0
if limited == 1 then
    retryAfterMs = rollbackMs + math.ceil((1 - tokens) / tokensPerMs)
end

return {limited, remaining, resetAfterMs, retryAfterMs}
`;
