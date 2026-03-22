import type { Algorithm, HeadersVersion } from 'universal-rate-limit';
import { getLimiter, getClientIp, getStoreHits, checkApiRateLimit } from '../../../lib/limiter-cache';

const ALLOWED_ALGORITHMS: Algorithm[] = ['fixed-window', 'sliding-window'];
const ALLOWED_HEADERS: HeadersVersion[] = ['draft-7', 'draft-6'];

function parseNumParam(value: string | null, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function pickAllowed<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

export async function GET(request: Request) {
    const blocked = await checkApiRateLimit(request);
    if (blocked) return blocked;

    const start = performance.now();
    const url = new URL(request.url);
    const ip = getClientIp(request);

    const config = {
        limit: Math.min(100, Math.max(1, parseNumParam(url.searchParams.get('limit'), 10))),
        windowMs: Math.max(1000, parseNumParam(url.searchParams.get('windowMs'), 30_000)),
        algorithm: pickAllowed(url.searchParams.get('algorithm'), ALLOWED_ALGORITHMS, 'fixed-window'),
        headers: pickAllowed(url.searchParams.get('headers'), ALLOWED_HEADERS, 'draft-7'),
        legacyHeaders: url.searchParams.get('legacyHeaders') === 'true'
    };

    const { limiter, configChanged } = getLimiter(ip, config);

    if (configChanged) {
        return Response.json(
            { error: 'configChanged', message: 'Rate limit configuration was changed in another tab. Please refresh.' },
            { status: 409 }
        );
    }

    const result = await limiter(request);
    const { currentWindowHits, previousWindowHits } = getStoreHits(ip);
    const responseTimeMs = Math.round((performance.now() - start) * 100) / 100;

    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(result.headers)) {
        responseHeaders.set(key, value);
    }

    return Response.json(
        {
            status: result.limited ? 429 : 200,
            limited: result.limited,
            limit: result.limit,
            remaining: result.remaining,
            resetTime: result.resetTime.toISOString(),
            headers: result.headers,
            responseTimeMs,
            currentWindowHits,
            previousWindowHits
        },
        {
            status: result.limited ? 429 : 200,
            headers: responseHeaders
        }
    );
}
