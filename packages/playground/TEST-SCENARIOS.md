# Test Scenarios and Edge Cases

Comprehensive test scenarios for the `universal-rate-limit` playground application.

---

## Basic Functionality

### Page Layout

- Page loads with correct layout sections in order: header, config panel, status dashboard, action bar, request log
- Header contains title "universal-rate-limit" linking to documentation site
- Header contains GitHub icon linking to GitHub repository
- Header contains npm icon linking to npm package page
- Header contains description text about the playground
- Header contains "Documentation" and "Get started" CTA buttons
- ThemeToggle button appears in top-right corner of header
- Page is centered with `max-w-3xl` container and responsive padding (`px-4 py-8 sm:px-6`)

### Default State

- Default config values are: limit=10, window=10s, algorithm=fixed-window, headers=draft-7, legacyHeaders=false
- Status dashboard shows "-- / --" for remaining/limit before any requests
- Status dashboard shows "--:--" for timer before any requests
- Status badge shows "IDLE" (gray) before any requests
- Progress bar is full width (100%) before any requests
- Request log shows empty state: "No requests yet. Click 'Send Request' to get started."
- Config panel heading is "Configuration"
- All config controls are enabled (not disabled)

### Send Single Request

- Click "Send Request" -> request appears in log as entry #1
- Status dashboard updates with remaining/limit values (e.g., "9 / 10")
- Status badge changes from "IDLE" to "OK" (green)
- Progress bar width decreases proportionally
- Timer starts counting down (fixed-window) or shows recovery time (sliding-window)
- Button text changes to "Sending..." while request is in flight
- Button is disabled while request is in flight
- Response time is shown in ms in the request log entry

### Send Burst Requests

- Click "Send Burst" dropdown -> shows menu with options: 5, 10, 15, 25 requests
- Select burst count -> button text changes to "Burst (N left)" showing remaining count
- Each request appears in the log with incrementing IDs
- Requests are sent with 50ms delay between each
- Status dashboard updates after each request in the burst
- When remaining reaches 0, subsequent requests get 429 status
- Action buttons are disabled during burst
- Burst menu closes when burst option is selected

---

## Rate Limiting

### Fixed Window Algorithm

- Send exactly `limit` requests -> last request should have remaining=0, status=200
- Send `limit + 1` requests -> last request gets 429 status, limited=true
- Request log entry shows red "429" badge for rate-limited requests
- Request log entry shows green "200" badge for allowed requests
- Status badge changes to "RATE LIMITED" (red) when limited=true
- Remaining count in request entry shows "0/10 remaining" for the limiting request
- After window expires, new requests succeed with fresh quota

### Sliding Window Algorithm

- Switch to sliding-window algorithm -> store resets, log clears
- Send requests -> remaining decreases with each request
- Remaining value may recover over time as previous window hits decay
- Progress bar animates smoothly as remaining increases between requests (interpolation)
- The interpolated remaining value updates every 200ms

### Header Formats

#### Draft 7 (default)

- Response headers include combined `ratelimit` header (e.g., `limit=10, remaining=9, reset=5`)
- Response headers include `ratelimit-policy` header
- Expanding a request log entry shows header table with these headers highlighted in blue

#### Draft 6

- Switch to draft-6 -> response headers include separate `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset` headers
- Header names are displayed in monospace font in the expanded view

#### Legacy Headers

- Enable legacy headers toggle -> response includes `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` headers
- Legacy headers appear alongside the selected draft format headers
- When rate limited, `retry-after` header is included

### Remaining Count Accuracy

- After 1 request with limit=10: remaining should be 9
- After 5 requests with limit=10: remaining should be 5
- After 10 requests with limit=10: remaining should be 0
- Remaining never goes below 0

---

## Timers and Progress Bar

### Fixed Window Countdown Timer

- After first request, "Window Reset" timer starts counting down from window duration
- Timer format for windows < 60s: shows seconds only (e.g., "8s")
- Timer format for windows >= 60s: shows minutes:seconds (e.g., "4:59")
- Timer counts down in real-time (updates every 200ms)
- When timer reaches 0, it shows "--" text
- When timer reaches 0, "--" text briefly flashes green (1 second flash animation)
- When timer reaches 3 seconds or less, text turns red
- After window expires, progress bar resets to full (remaining = limit)
- After window expires, status badge changes from "RATE LIMITED" to "OK" (if was limited)

### Sliding Window Recovery Timer

- Label shows "Full Recovery" instead of "Window Reset"
- Timer shows time until all hits fully decay (remaining returns to limit)
- If only current window hits exist: full recovery = resetTime + windowMs (up to 2x window)
- If only previous window hits exist: full recovery = resetTime
- Timer reaches 0 when all hits have decayed -> shows "--" with green flash
- Timer turns red at 3 seconds or less remaining
- Timer format for values with minutes: "M:SS", for seconds only: "Ns"

### Progress Bar Behavior

- Green color when ratio > 0.5 (more than half remaining)
- Yellow color when ratio > 0.2 and <= 0.5
- Red color when ratio <= 0.2 or when limited
- Smooth transitions between states via CSS `transition-all duration-300`
- Width is calculated as `(remaining / limit) * 100%`
- In sliding-window mode, bar animates smoothly as interpolated remaining increases between requests
- After fixed-window expiry, bar jumps to 100% (full)

---

## Configuration

### Config Changes Reset State

- Change limit value -> calls POST /api/reset, clears request log, resets entry IDs to 1
- Change window preset -> calls POST /api/reset, clears request log
- Change algorithm (Fixed <-> Sliding) -> calls POST /api/reset, clears request log
- Change header format (Draft 7 <-> Draft 6) -> calls POST /api/reset, clears request log
- Toggle legacy headers on/off -> calls POST /api/reset, clears request log

### Limit Input

- Limit input is a number field with min=1, max=100
- Entering a value > 100 clamps to 100 (enforced by `Math.min(100, ...)`)
- Entering a value < 1 clamps to 1 (enforced by `Math.max(1, ...)`)
- Entering non-numeric value defaults to 1 (via `Number(e.target.value) || 1`)
- Input uses `tabular-nums` font for numeric alignment
- Input is disabled when sending or config is stale

### Window Presets

- Four preset buttons available: 10s (10000ms), 30s (30000ms), 1m (60000ms), 5m (300000ms)
- Active preset button is highlighted blue, others are gray/white
- Only one preset can be active at a time
- Buttons are disabled when sending or config is stale

### Algorithm Toggle

- Two buttons: "Fixed" and "Sliding"
- Active button highlighted blue
- Selecting the already-active algorithm still triggers a config change (reset)

### Header Format Toggle

- Two buttons: "Draft 7" and "Draft 6"
- Active button highlighted blue

### Legacy Headers Toggle

- Styled as a sliding toggle switch (h-8 w-14)
- Blue when enabled, gray when disabled
- White circular knob slides left/right (`translate-x-1` off, `translate-x-7` on)

### Config Panel Disabled State

- All config controls show `disabled:opacity-50` when disabled
- Config panel is disabled during request sending (`isSending`)
- Config panel is disabled when config is stale (`configStale`)

---

## Multi-tab / Config Conflicts

### Config Conflict Detection

- Server stores one config per IP address in the limiter cache
- If tab A sends a request with config X, then tab B sends with config Y, tab B's request succeeds (creates new limiter) and `configChanged=true` is returned
- Actually: if tab A has an existing config and tab B sends a different config, the server replaces the limiter and returns 409 to the _changing_ tab with `{ error: 'configChanged' }`
- Wait -- re-reading the code: `getLimiter` returns `configChanged: true` when an existing entry is found with a different config. The route handler returns 409 when `configChanged` is true.
- So: tab A establishes a config. Tab B sends with a different config -> server detects config mismatch -> tears down old limiter, creates new one -> returns 409 to tab B
- On receiving 409, the client sets `configStale = true` and returns null (no log entry added)

### Stale Config Banner

- When configStale is true, a yellow/amber banner appears above the config panel
- Banner text: "The rate limit configuration was changed in another tab. Please refresh to continue."
- Banner has a "Refresh" button that calls `globalThis.location.reload()`
- Banner styling: amber border, amber background, dark mode compatible

### Stale Config Disables Controls

- When configStale is true, `isSending` prop passed to ActionBar is `isSending || configStale`
- This disables: Send Request, Send Burst, and Reset buttons
- Config panel is also disabled (`disabled={isSending || configStale}`)
- Clear Log button is NOT disabled by configStale (it has no `disabled` prop)

### Burst Stops on Stale Config

- During a burst, if a request returns null (409 config changed) and `configStale` is true, the burst loop breaks
- Remaining burst requests are not sent

---

## Dark Mode

### Theme Toggle

- Click moon icon (light mode) -> switches to dark mode, shows sun icon
- Click sun icon (dark mode) -> switches to light mode, shows moon icon
- Toggle button has aria-label "Toggle theme"
- Toggle button has hover background effect

### Dark Mode Persistence

- Toggling dark mode saves preference to `localStorage.setItem('theme', 'dark'|'light')`
- On page load, inline script checks localStorage for 'theme' key
- If theme is 'dark', adds 'dark' class to `<html>` and sets `colorScheme: 'dark'`
- Script runs before React hydration to prevent flash of wrong theme

### System Preference Fallback

- If no localStorage theme is set, checks `matchMedia('(prefers-color-scheme:dark)')`
- If system prefers dark, applies dark mode on first visit
- Once user manually toggles, localStorage value takes precedence

### Dark Mode Visual Changes

- Body: `bg-gray-50` -> `bg-gray-950`, `text-gray-900` -> `text-gray-100`
- Config panel: border/bg colors change to dark variants
- Status dashboard: border/bg colors change to dark variants
- Action buttons: dark mode hover states
- Request log: dark mode borders and backgrounds
- Header display table: dark mode styling
- Scrollbar thumb color changes in dark mode
- Custom dark variant defined as `@custom-variant dark (&:where(.dark, .dark *))`

---

## Edge Cases

### Timing Edge Cases

- Send request immediately after reset -> fresh window, remaining = limit - 1
- Window expires exactly between sending request and receiving response -> response may be in new window
- Very fast window (10s) -> countdown timer and reset work correctly within short timeframe
- Window expires during a burst -> some requests fail (429), then after window resets, remaining requests in burst may succeed in the new window

### Rapid Interaction

- Rapid clicking "Send Request" -> button is disabled during send, so only one request at a time
- Multiple rapid config changes -> each change calls reset, only the latest config state is used
- Click "Send Request" immediately after changing config -> request uses new config

### Burst Edge Cases

- Start burst while already rate limited -> first request in burst gets 429 (limited), burst continues through remaining count
- Start burst with count > limit -> first `limit` requests succeed, rest get 429
- Change config while burst is in progress -> burst stops because sendRequest returns null on 409, and configStale check breaks the loop
- Close burst dropdown by clicking the button again (toggle behavior)
- Burst dropdown only shows when not sending (`showBurstMenu && !isSending`)

### Progress Bar Edge Cases

- At exactly 0 remaining -> bar width is 0%, color is red
- At remaining = 1 with limit = 10 -> ratio = 0.1, color is red (ratio <= 0.2)
- At remaining = 3 with limit = 10 -> ratio = 0.3, color is yellow (0.2 < ratio <= 0.5)
- At remaining = 6 with limit = 10 -> ratio = 0.6, color is green (ratio > 0.5)
- Sliding window recovery from 0 -> interpolated remaining increases smoothly, bar transitions from red through yellow to green

### Sliding Window Interpolation Edge Cases

- No hits (currentWindowHits=0, previousWindowHits=0) -> interpolation disabled, shows raw remaining
- Only current window hits, no previous -> remaining stays flat (no decay within current window)
- Previous hits decaying within current window -> weight = `max(0, 1 - elapsed/windowMs)`, remaining increases
- Past resetTime -> current hits become "previous" in new window, total hits decay with weight
- Interpolation updates every 200ms via setInterval
- Interpolated remaining is clamped: `Math.max(0, Math.min(entry.limit, ...))`

### API Edge Cases

- Server-side limit clamping: `Math.min(100, Math.max(1, Number(param)))` ensures valid limit
- Server-side windowMs minimum: `Math.max(1000, Number(param))` ensures >= 1 second
- Invalid algorithm param -> cast as Algorithm type (no validation, defaults to whatever core library does)
- Invalid headers param -> cast as HeadersVersion type (no validation)
- API rate limit: 120 requests per minute per IP (meta rate limit on playground API itself)
- If playground API rate limit exceeded -> returns 429 with "Playground rate limit exceeded. Try again shortly."

### Cache Edge Cases

- LRU eviction: when cache has 30 entries, oldest (by insertion order) is evicted for new IP
- TTL cleanup: entries unused for > 5 minutes are cleaned up every 60 seconds
- Cleanup timer uses `.unref()` so it doesn't keep the Node process alive
- Reset by IP: calls `store.resetAll()`, `store.shutdown()`, and deletes the cache entry

---

## Reset

### Reset Behavior

- Click "Reset" button -> sends POST to /api/reset
- Server calls `resetByIp(ip)` which resets and shuts down the MemoryStore for that IP, removes cache entry
- Client clears request log after reset
- Client resets entry ID counter to 1
- After reset, next request gets full quota (remaining = limit - 1)
- Reset does NOT change the current config (limit, window, algorithm, headers, legacyHeaders remain the same)
- Reset button is disabled during sending or when config is stale

### Clear Log

- "Clear Log" button only clears the client-side request log
- Does NOT send any request to the server
- Does NOT reset the server-side rate limit store
- Clear Log button is never disabled (no `disabled` prop)
- After clearing log, status dashboard still shows last known state (latestEntry becomes null since log is empty, so dashboard resets to IDLE)
- Wait -- `clearLog` sets `setLog([])`, and `latestEntry = log[0] ?? null`, so latestEntry becomes null after clear
- Status dashboard returns to initial state: "-- / --", "--:--" timer, "IDLE" badge

---

## Visual / Layout

### Config Panel Layout

- Uses `flex flex-wrap gap-4` so buttons wrap on narrow screens without overlapping
- Each config group has a label above it (text-xs font-medium)
- Limit input has fixed width (`w-20`)

### Numeric Display

- All numeric values in the UI use `tabular-nums` CSS class for consistent alignment
- This applies to: remaining/limit in status dashboard, remaining/limit in log entries, response time, request IDs
- Response time shown in ms with 2 decimal places (rounded via `Math.round(... * 100) / 100`)

### Request Log

- Shows most recent request first (entries prepended to array: `[entry, ...prev]`)
- Maximum visible height of 384px (`max-h-96`) with overflow scroll
- Custom scrollbar styling via `.log-scroll` class (6px width, rounded thumb)
- Each entry is expandable -- click to toggle showing response headers
- Entry shows: request number (#N), status badge (200/429), remaining/limit, response time (ms), relative timestamp
- Relative timestamp shows "just now" for < 5s, "Ns ago" for < 60s, "Nm ago" for >= 60s
- Expand icon rotates 180 degrees when entry is expanded
- Last entry in list has no bottom border (`last:border-0`)

### Header Display (Expanded Entry)

- Shows a table with Header and Value columns
- Rate limit headers are highlighted in blue (`font-semibold text-blue-600`)
- Recognized rate limit headers: `ratelimit`, `ratelimit-policy`, `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `retry-after`
- Non-rate-limit headers shown in gray
- All header names and values use monospace font

### Responsive Design

- Main container: `max-w-3xl` with `px-4 sm:px-6` responsive padding
- Title text: `text-2xl sm:text-3xl` responsive sizing
- Status dashboard items use `flex flex-wrap` with `min-w` constraints
- Action bar uses `flex flex-wrap` for wrapping on small screens

### Accessibility

- Theme toggle has `aria-label="Toggle theme"`
- GitHub link has `aria-label="GitHub repository"`
- npm link has `aria-label="npm package"`
- `<html lang="en">` set on root element
- `suppressHydrationWarning` on `<html>` to prevent hydration mismatch from theme script

---

## API Endpoints

### GET /api/rate-limit

- Query params: `limit`, `windowMs`, `algorithm`, `headers`, `legacyHeaders`
- Returns JSON: `{ status, limited, limit, remaining, resetTime, headers, responseTimeMs, currentWindowHits, previousWindowHits }`
- HTTP status matches `result.limited ? 429 : 200`
- Rate limit headers are set on the actual HTTP response (not just in the JSON body)
- Returns 409 with `{ error: 'configChanged' }` if config differs from cached config for that IP
- Subject to meta rate limit (120 req/min per IP)

### POST /api/reset

- No request body needed
- Resets the rate limit store for the requesting IP
- Returns `{ ok: true }`
- Subject to meta rate limit (120 req/min per IP)
