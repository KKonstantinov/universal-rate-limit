import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '../../src/app/api/rate-limit/route';

interface ApiResponseBody {
    status: number;
    limited: boolean;
    limit: number;
    remaining: number;
    resetTime: string;
    headers: Record<string, string>;
    responseTimeMs: number;
    currentWindowHits: number;
    previousWindowHits: number;
    error?: string;
    message?: string;
}

// Clean up the global cache between tests
beforeEach(() => {
    const g = globalThis as unknown as {
        __rateLimitCache?: Map<string, unknown>;
    };
    if (g.__rateLimitCache) {
        g.__rateLimitCache.clear();
    }
});

afterEach(() => {
    const g = globalThis as unknown as {
        __rateLimitCache?: Map<string, unknown>;
    };
    if (g.__rateLimitCache) {
        g.__rateLimitCache.clear();
    }
});

function createRouteRequest(params: Record<string, string>, ip = '10.0.0.1'): Request {
    const url = new URL('http://localhost/api/rate-limit');
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return new Request(url.toString(), {
        headers: { 'x-forwarded-for': ip }
    });
}

describe('GET /api/rate-limit', () => {
    // ── Token bucket parameter parsing ──

    it('accepts token-bucket algorithm', async () => {
        const req = createRouteRequest({
            algorithm: 'token-bucket',
            refillRate: '10',
            limit: '10'
        });
        const res = await GET(req);
        const body = (await res.json()) as ApiResponseBody;

        expect(res.status).toBe(200);
        expect(body.limited).toBe(false);
        expect(body.remaining).toBe(9);
        expect(body.limit).toBe(10);
    });

    it('defaults refillRate to 1 when not provided', async () => {
        const req = createRouteRequest(
            {
                algorithm: 'token-bucket',
                limit: '5'
            },
            '10.0.0.2'
        );
        const res = await GET(req);
        const body = (await res.json()) as ApiResponseBody;

        expect(res.status).toBe(200);
        expect(body.limited).toBe(false);
        expect(body.remaining).toBe(4);
    });

    it('clamps negative refillRate to 1', async () => {
        const req = createRouteRequest(
            {
                algorithm: 'token-bucket',
                refillRate: '-5',
                limit: '10'
            },
            '10.0.0.3'
        );
        const res = await GET(req);
        const body = (await res.json()) as ApiResponseBody;

        expect(res.status).toBe(200);
        expect(body.limited).toBe(false);
    });

    it('clamps refillRate above 100 to 100', async () => {
        const req = createRouteRequest(
            {
                algorithm: 'token-bucket',
                refillRate: '200',
                limit: '10'
            },
            '10.0.0.4'
        );
        const res = await GET(req);

        expect(res.status).toBe(200);
    });

    it('returns 429 when token bucket is exhausted', async () => {
        const ip = '10.0.0.5';
        const params = {
            algorithm: 'token-bucket',
            refillRate: '10',
            limit: '3'
        };

        // Send 3 requests to exhaust tokens
        for (let i = 0; i < 3; i++) {
            await GET(createRouteRequest(params, ip));
        }

        // 4th request should be limited
        const res = await GET(createRouteRequest(params, ip));
        const body = (await res.json()) as ApiResponseBody;

        expect(res.status).toBe(429);
        expect(body.limited).toBe(true);
        expect(body.remaining).toBe(0);
        expect(body.status).toBe(429);
    });

    it('includes retry-after header when rate limited', async () => {
        const ip = '10.0.0.6';
        const params = {
            algorithm: 'token-bucket',
            refillRate: '10',
            limit: '2'
        };

        // Exhaust tokens
        for (let i = 0; i < 2; i++) {
            await GET(createRouteRequest(params, ip));
        }

        const res = await GET(createRouteRequest(params, ip));
        expect(res.status).toBe(429);

        // Check that Retry-After header exists in the response body headers
        const body = (await res.json()) as ApiResponseBody;
        expect(body.headers['Retry-After']).toBeDefined();
    });

    it('returns resetTime as ISO string', async () => {
        const req = createRouteRequest(
            {
                algorithm: 'token-bucket',
                refillRate: '10',
                limit: '10'
            },
            '10.0.0.7'
        );
        const res = await GET(req);
        const body = (await res.json()) as ApiResponseBody;

        expect(body.resetTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns zero window hits for token-bucket', async () => {
        const req = createRouteRequest(
            {
                algorithm: 'token-bucket',
                refillRate: '10',
                limit: '10'
            },
            '10.0.0.8'
        );
        const res = await GET(req);
        const body = (await res.json()) as ApiResponseBody;

        expect(body.currentWindowHits).toBe(0);
        expect(body.previousWindowHits).toBe(0);
    });

    it('includes responseTimeMs in response', async () => {
        const req = createRouteRequest(
            {
                algorithm: 'token-bucket',
                refillRate: '10',
                limit: '10'
            },
            '10.0.0.9'
        );
        const res = await GET(req);
        const body = (await res.json()) as ApiResponseBody;

        expect(body.responseTimeMs).toBeTypeOf('number');
        expect(body.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    // ── Config change detection ──

    it('returns 409 when config changes for same IP', async () => {
        const ip = '10.0.0.10';

        // First request with fixed-window
        await GET(
            createRouteRequest(
                {
                    algorithm: 'fixed-window',
                    limit: '10',
                    windowMs: '10000'
                },
                ip
            )
        );

        // Second request with token-bucket — config changed
        const res = await GET(
            createRouteRequest(
                {
                    algorithm: 'token-bucket',
                    refillRate: '10',
                    limit: '10'
                },
                ip
            )
        );

        const body = (await res.json()) as ApiResponseBody;
        expect(res.status).toBe(409);
        expect(body.error).toBe('configChanged');
    });

    it('returns 409 when refillRate changes for token-bucket', async () => {
        const ip = '10.0.0.11';

        // First request with refillRate=5
        await GET(
            createRouteRequest(
                {
                    algorithm: 'token-bucket',
                    refillRate: '5',
                    limit: '10'
                },
                ip
            )
        );

        // Second request with refillRate=20 — config changed
        const res = await GET(
            createRouteRequest(
                {
                    algorithm: 'token-bucket',
                    refillRate: '20',
                    limit: '10'
                },
                ip
            )
        );

        const body = (await res.json()) as ApiResponseBody;
        expect(res.status).toBe(409);
        expect(body.error).toBe('configChanged');
    });

    // ── Rate limit headers on response ──

    it('sets rate limit headers on the HTTP response', async () => {
        const req = createRouteRequest(
            {
                algorithm: 'token-bucket',
                refillRate: '10',
                limit: '10',
                headers: 'draft-7'
            },
            '10.0.0.12'
        );
        const res = await GET(req);

        expect(res.headers.get('ratelimit')).toBeTruthy();
        expect(res.headers.get('ratelimit-policy')).toBeTruthy();
    });

    // ── Fixed window still works ──

    it('still handles fixed-window correctly', async () => {
        const req = createRouteRequest(
            {
                algorithm: 'fixed-window',
                limit: '5',
                windowMs: '60000'
            },
            '10.0.0.13'
        );
        const res = await GET(req);
        const body = (await res.json()) as ApiResponseBody;

        expect(res.status).toBe(200);
        expect(body.remaining).toBe(4);
        expect(body.limit).toBe(5);
    });

    // ── Invalid algorithm defaults to fixed-window ──

    it('defaults to fixed-window for invalid algorithm', async () => {
        const req = createRouteRequest(
            {
                algorithm: 'invalid-algo',
                limit: '10'
            },
            '10.0.0.14'
        );
        const res = await GET(req);
        const body = (await res.json()) as ApiResponseBody;

        expect(res.status).toBe(200);
        expect(body.limited).toBe(false);
    });
});
