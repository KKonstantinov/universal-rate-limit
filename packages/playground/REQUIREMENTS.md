# Playground Requirements

## Overview

The playground is an interactive Next.js web application that lets users experiment with the `universal-rate-limit` library in real time. Users configure rate limiting parameters (limit, window, algorithm, header format), fire HTTP requests, and observe rate limiting behavior
through a live status dashboard with progress bars, countdown timers, and a detailed request log showing IETF-compliant headers.

Built with Next.js (App Router, Turbopack), React 19, and Tailwind CSS v4. Uses the `universal-rate-limit` core package directly (workspace dependency). The app is private and not published.

---

## Configurable Options

The Configuration panel exposes the following controls. All controls are disabled while a request or burst is in flight, or when the config is stale (conflict detected).

### Limit

- Numeric input field.
- Minimum: 1.
- Maximum: 100.
- Default: 10.
- Client-side clamping: `Math.max(1, Math.min(100, value))`.
- Server-side clamping: `Math.min(100, Math.max(1, value))`.

### Window

- Preset button group (only one active at a time).
- Options: **10s** (10,000ms), **30s** (30,000ms), **1m** (60,000ms), **5m** (300,000ms).
- Default: 10s (10,000ms).
- Server enforces a minimum of 1,000ms.
- Active preset is highlighted with `bg-blue-600` styling.

### Algorithm

- Toggle button group: **Fixed** (`fixed-window`) or **Sliding** (`sliding-window`).
- Default: `fixed-window`.

### Header Format

- Toggle button group: **Draft 7** (`draft-7`) or **Draft 6** (`draft-6`).
- Default: `draft-7`.

### Legacy Headers

- Toggle switch (pill-shaped boolean toggle).
- Default: off (`false`).
- When on, the server includes `X-RateLimit-*` headers in addition to the standard IETF headers.

### Config Change Behavior

When any configuration option changes:

1. The server-side rate limiter for this IP is reset (via `POST /api/reset`).
2. The client-side request log is cleared.
3. The request ID counter resets to 1.
4. The `configStale` flag is cleared.

---

## API Endpoints

### `GET /api/rate-limit`

Accepts rate limit configuration via query parameters and returns the rate limit result.

**Query Parameters:**

| Parameter       | Type   | Default        | Validation                         |
| --------------- | ------ | -------------- | ---------------------------------- |
| `limit`         | number | `10`           | Clamped to `[1, 100]`              |
| `windowMs`      | number | `30000`        | Minimum 1,000ms                    |
| `algorithm`     | string | `fixed-window` | `fixed-window` or `sliding-window` |
| `headers`       | string | `draft-7`      | `draft-7` or `draft-6`             |
| `legacyHeaders` | string | `false`        | `"true"` to enable                 |

**Response (200 or 429):**

```json
{
    "status": 200,
    "limited": false,
    "limit": 10,
    "remaining": 9,
    "resetTime": "2024-01-01T00:00:10.000Z",
    "headers": { "ratelimit": "limit=10, remaining=9, reset=10" },
    "responseTimeMs": 0.42,
    "currentWindowHits": 1,
    "previousWindowHits": 0
}
```

- HTTP status matches `result.limited ? 429 : 200`.
- Rate limit headers are set on the actual HTTP response as well as included in the JSON body.
- `responseTimeMs` is measured with `performance.now()`, rounded to 2 decimal places.
- `currentWindowHits` and `previousWindowHits` are raw hit counts from the MemoryStore, used for client-side sliding window interpolation.

**Config Conflict Response (409):**

```json
{
    "error": "configChanged",
    "message": "Rate limit configuration was changed in another tab. Please refresh."
}
```

Returned when a different tab/client from the same IP has changed the rate limit configuration since this client's last request.

### `POST /api/reset`

Resets the rate limiter state for the calling IP.

**Response (200):**

```json
{ "ok": true }
```

Internally calls `resetByIp(ip)` which:

1. Calls `store.resetAll()` on the MemoryStore.
2. Calls `store.shutdown()` to clean up the background timer.
3. Removes the cache entry for this IP.

### Meta Rate Limiting

Both endpoints are protected by a meta rate limiter that prevents abuse of the playground API itself:

- **Limit:** 120 requests per window.
- **Window:** 60,000ms (1 minute).
- **Algorithm:** `fixed-window`.
- **Headers:** `draft-7`.

If the meta rate limit is exceeded, the endpoint returns:

```json
{ "error": "Playground rate limit exceeded. Try again shortly." }
```

with HTTP status 429 and appropriate rate limit headers.

---

## Abuse Prevention

### IP-Based Keying

- Client IP is extracted from request headers in this priority order: `x-forwarded-for` (first value before comma), `x-real-ip`, `cf-connecting-ip`, `fly-client-ip`.
- Falls back to `127.0.0.1` if no header is present.
- Each IP gets exactly one limiter instance with one active config at a time.

### Limiter Cache

- **Maximum cache entries:** 30 (one per IP).
- **Eviction policy:** LRU-style -- when the cache is full, the oldest entry (by insertion order via `Map` iteration) is evicted. The evicted entry's MemoryStore is shut down.
- **TTL:** 300,000ms (5 minutes). Entries not accessed within this period are cleaned up.
- **Cleanup interval:** Every 60,000ms (1 minute), a background sweep removes stale entries.
- The cleanup timer is `.unref()`'d so it does not prevent Node.js process exit.
- The cache is stored on `globalThis.__rateLimitCache` to survive Next.js hot module replacement.

### Meta Rate Limit

- 120 requests per minute per IP across all playground API endpoints.
- Uses a separate `fixed-window` rate limiter instance (not per-user configurable).
- Applied before the user's configured rate limiter runs.

---

## Multi-Tab Conflict Detection

Since each IP gets exactly one active rate limiter configuration:

### Detection Mechanism

1. When `GET /api/rate-limit` is called, the server compares the requested config against the stored config for that IP.
2. If the configs differ (meaning another tab changed the config), the old limiter is torn down, a new one is created, and the response returns `configChanged: true`.
3. The server responds with HTTP 409 and `{ "error": "configChanged" }`.

### Client-Side Handling

1. On receiving a 409 with `error === "configChanged"`, the `configStale` flag is set to `true`.
2. A **stale config banner** appears at the top of the playground with:
    - Warning message: "The rate limit configuration was changed in another tab. Please refresh to continue."
    - A "Refresh" button that calls `globalThis.location.reload()`.
3. While `configStale` is true:
    - All configuration controls are disabled.
    - The "Send Request" and "Send Burst" buttons are disabled.
    - Any in-progress burst is stopped.

---

## Status Dashboard

The status dashboard shows real-time rate limit status based on the most recent request log entry.

### Remaining Progress Bar

- Displays `remaining / limit` as text (e.g., "7 / 10").
- A horizontal progress bar shows the ratio visually.
- Before any request: shows `-- / --` with a full (100%) gray bar.

**Bar Color Thresholds (based on `remaining / limit` ratio):**

- `ratio > 0.5`: green (`bg-green-500`)
- `0.2 < ratio <= 0.5`: yellow (`bg-yellow-500`)
- `ratio <= 0.2` or rate limited: red (`bg-red-500`)

**Fixed Window Behavior:**

- The progress bar shows the server-reported `remaining` value.
- When the window expires (current time passes `resetTime`), the `windowExpired` flag is set via a `setTimeout`.
- Once expired: remaining resets to `limit`, `limited` becomes `false`, and the bar returns to full/green.

**Sliding Window Behavior:**

- Real-time interpolation runs every 200ms via `setInterval`.
- The `interpolateRemaining()` function projects what the server would return at the current moment:
    - **Phase 1 (before resetTime, with previous hits):** Previous window hits decay linearly. `weight = max(0, 1 - elapsed/windowMs)`. Interpolated hits = `ceil(previousWindowHits * weight + currentWindowHits)`. Remaining = `limit - interpolatedHits`.
    - **Phase 2 (before resetTime, no previous hits):** Remaining stays at the server-reported value (no decay).
    - **Phase 3 (past resetTime):** Current hits become "previous" in the new window and start decaying. `weight = max(0, 1 - elapsedInNewWindow/windowMs)`. Total decaying hits = `currentWindowHits + previousWindowHits` (from original window).
- If total hits (current + previous) are 0, interpolation is disabled and the raw server value is used.

### Timer Display

**Fixed Window -- "Window Reset" countdown:**

- Shows seconds remaining until `resetTime`.
- Format: `Xs` for windows under 60s, `M:SS` for windows 60s or longer.
- Updates every 200ms.
- When countdown reaches 0: displays `--` with a brief green flash animation (1s duration).
- When countdown is 3 seconds or less: text turns red.

**Sliding Window -- "Full Recovery" timer:**

- Shows time until `remaining` would return to `limit` (assuming no new requests).
- Calculation: if there are current window hits, full recovery = `resetTime + windowMs`; otherwise, full recovery = `resetTime`.
- Format: `Xs` for values under 60s, `M:SS` for 60s or longer.
- Updates every 200ms.
- When timer reaches 0: displays `--` with a brief green flash animation.
- When timer is 3 seconds or less: text turns red.

### Status Badge

Three possible states:

- **IDLE** (gray badge): No requests sent yet (`latestEntry` is null).
- **OK** (green badge): Latest request was not rate limited.
- **RATE LIMITED** (red badge): Latest request was rate limited (`remaining <= 0` for sliding window interpolation, or `limited === true` for fixed window).

For fixed window: badge resets to OK when the window expires. For sliding window: badge transitions based on the real-time interpolated remaining value.

---

## Action Bar

### Send Request Button

- Label: "Send Request" (or "Sending..." while a single request is in flight with no burst).
- Disabled while sending or when config is stale.
- Sends a single `GET /api/rate-limit` request with current config as query params.

### Send Burst Button

- Label: "Send Burst" (or "Burst (N left)" during a burst).
- Opens a dropdown menu with burst size options: **5**, **10**, **15**, **25** requests.
- The dropdown is hidden while sending.
- Disabled while sending or when config is stale.

**Burst Behavior:**

- Sends requests sequentially (not in parallel).
- 50ms delay between each request (`setTimeout` with 50ms).
- No delay after the final request.
- `burstRemaining` counter decrements as each request fires.
- Burst stops early if `configStale` becomes true (another tab changed the config).
- If a request returns null (error or 409 config conflict), the burst also stops.

### Reset Button

- Sends `POST /api/reset` to clear the server-side rate limiter for this IP.
- Clears the client-side request log.
- Resets the request ID counter to 1.
- Disabled while sending.

### Clear Log Button

- Clears the client-side request log only (does not reset server-side state).
- Always enabled (not disabled while sending).

### Visual Layout

- Buttons are laid out horizontally with flex-wrap.
- A vertical divider (1px gray line) separates the Send/Burst buttons from the Reset/Clear buttons.

---

## Request Log

### Empty State

- When no requests have been sent, displays a dashed-border container with the message: `No requests yet. Click "Send Request" to get started.`
- Fixed height: `h-48`.

### Log Container

- Scrollable list with max height `max-h-96` (384px).
- Custom scrollbar styling (6px width, rounded, semi-transparent).
- Entries are displayed in reverse chronological order (newest first).
- Container has rounded borders and a white/dark background.

### Request Entry (Collapsed)

Each entry shows a single row with:

1. **Request number:** `#N` in monospace gray text (8-wide column).
2. **Status badge:** `200` (green) or `429` (red) in a small colored pill.
3. **Remaining/Limit:** `N/M remaining` in tabular-nums.
4. **Response time:** `Xms` in small gray text.
5. **Relative timestamp:** "just now" (< 5s), "Xs ago" (< 60s), or "Xm ago".
6. **Expand chevron:** Rotates 180 degrees when expanded.

The entire row is clickable to toggle expansion.

### Request Entry (Expanded)

Shows a table of response headers with two columns: **Header** and **Value**.

**Header highlighting:** Known rate-limit headers are displayed in bold blue (`text-blue-600`). The recognized headers are:

- `ratelimit`, `ratelimit-policy`
- `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`
- `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`
- `retry-after`

All other headers appear in regular gray text.

---

## Dark Mode

### Implementation

- Uses Tailwind CSS v4 class-based dark mode with a custom variant: `@custom-variant dark (&:where(.dark, .dark *))`.
- The `dark` class is toggled on `<html>` element.
- `colorScheme` CSS property is also set on `<html>` for native form control theming.
- `suppressHydrationWarning` is set on `<html>` to prevent React hydration mismatch.

### Persistence

- Stored in `localStorage` under key `"theme"` with values `"dark"` or `"light"`.
- On page load, an inline `<script>` (before React hydration) checks:
    1. `localStorage.getItem('theme')` -- if `"dark"`, add the `dark` class.
    2. If no stored preference, check `matchMedia('(prefers-color-scheme:dark)')` -- if matches, add the `dark` class.
- This prevents a flash of unstyled content (FOUC) on dark-mode-preferring systems.

### Toggle Button

- Located in the top-right corner of the header.
- Shows a **sun icon** (outline) when in dark mode (clicking switches to light).
- Shows a **moon icon** (outline) when in light mode (clicking switches to dark).
- On click: toggles the `dark` class, updates `localStorage`, and updates component state.

---

## Page Header

### Title

- Text: "universal-rate-limit".
- Links to the documentation site.
- Bold, large text (`text-2xl sm:text-3xl`), underline on hover.

### Icons (inline with title)

- **GitHub icon:** SVG icon linking to the GitHub repository. Gray with hover color transition.
- **npm icon:** SVG icon linking to the npm package page. Gray with hover color transition.

### Description

Two lines of descriptive text below the title:

1. "Interactive playground for the universal-rate-limit library -- a web-standards-based rate limiter for any JS runtime."
2. "Configure limits, algorithms, and header formats, then fire requests to see rate limiting in action with real-time status and IETF-compliant headers."

### CTA Buttons

- **Documentation** (primary): Blue filled button linking to the docs site.
- **Get started** (secondary): Outlined button linking to the getting-started guide.

### Theme Toggle

- Positioned at the top-right of the header area (`flex items-start justify-between`).

---

## Page Layout

- Max width: `max-w-3xl` (768px).
- Centered with `mx-auto`.
- Padding: `px-4 py-8 sm:px-6`.
- Background: light gray (`bg-gray-50`), dark mode: near-black (`bg-gray-950`).
- Font: system sans-serif stack.
- Anti-aliased text rendering.

### Section Order (top to bottom)

1. Page Header (with theme toggle)
2. Stale Config Banner (conditional)
3. Configuration Panel
4. Status Dashboard
5. Action Bar
6. Request Log

Each section has `mb-4` bottom margin except the header (`mb-8`) and the request log (no bottom margin).

---

## Custom Theme Colors

Defined in `globals.css` under `@theme`:

- `--color-green-glow`: `oklch(0.75 0.18 145)` -- used for positive/OK states.
- `--color-red-glow`: `oklch(0.65 0.2 25)` -- used for error/limited states.
- `--color-yellow-glow`: `oklch(0.8 0.15 85)` -- used for warning states.

---

## SEO and Robots

- Page title: "Playground -- universal-rate-limit".
- Meta description: "Interactive playground for experimenting with rate limiting algorithms, headers, and configuration."
- `robots.txt`: Disallows all crawlers from all paths (`userAgent: '*', disallow: '/'`).

---

## Default Configuration

When the playground first loads, the default configuration is:

| Option         | Default Value  |
| -------------- | -------------- |
| Limit          | 10             |
| Window         | 10s (10,000ms) |
| Algorithm      | fixed-window   |
| Headers        | draft-7        |
| Legacy Headers | false          |
