// ── Lua Scripts ─────────────────────────────────────────────────────────────
// Atomic Redis operations for rate limiting.

/**
 * Increment script.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = windowMs (TTL in milliseconds)
 * ARGV[2] = resetExpiryOnChange ("1" or "0")
 *
 * Returns: { totalHits, timeToExpire } as a two-element array.
 *
 * If the key doesn't exist or has no TTL (expired), sets it to 1 with a PX
 * expiry and returns {1, windowMs}. Otherwise increments and returns the
 * current count + remaining TTL. When resetExpiryOnChange is "1", the TTL
 * is refreshed on every increment.
 */
export const INCREMENT_SCRIPT = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local resetExpiry = ARGV[2] == "1"

local ttl = redis.call("PTTL", key)

if ttl <= 0 then
    redis.call("SET", key, 1, "PX", windowMs)
    return {1, windowMs}
end

local totalHits = redis.call("INCR", key)

if resetExpiry then
    redis.call("PEXPIRE", key, windowMs)
    return {totalHits, windowMs}
end

return {totalHits, ttl}
`;

/**
 * Get script.
 *
 * KEYS[1] = rate limit key
 *
 * Returns: { totalHits, timeToExpire } as a two-element array.
 * If the key doesn't exist, returns {-1, -1}.
 */
export const GET_SCRIPT = `
local key = KEYS[1]
local value = redis.call("GET", key)

if value == false then
    return {-1, -1}
end

local ttl = redis.call("PTTL", key)
return {tonumber(value), ttl}
`;
