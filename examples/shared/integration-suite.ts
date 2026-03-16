import { describe, it, expect } from 'vitest';

export interface SuiteOptions {
    /** Base path for the rate-limited root endpoint (default: '/') */
    basePath?: string;
}

export function rateLimitIntegrationSuite(framework: string, options: SuiteOptions = {}) {
    const baseUrl = process.env['TEST_BASE_URL']!;
    const basePath = options.basePath ?? '/';
    const rootUrl = basePath === '/' ? baseUrl : `${baseUrl}${basePath}`;

    describe(`${framework} rate limiting (${basePath}, /api/hello, /api/data)`, () => {
        it(`returns 200 with rate limit headers for GET ${basePath}`, async () => {
            const ip = `test-headers-${String(Date.now())}`;
            const res = await fetch(rootUrl, { headers: { 'x-forwarded-for': ip } });

            expect(res.status).toBe(200);
            expect(res.headers.get('ratelimit')).toBeTruthy();
            expect(res.headers.get('ratelimit-policy')).toBeTruthy();
        });

        it('returns correct draft-7 header format', async () => {
            const ip = `test-draft7-${String(Date.now())}`;
            const res = await fetch(rootUrl, { headers: { 'x-forwarded-for': ip } });

            const rl = res.headers.get('ratelimit');
            expect(rl).toMatch(/limit=\d+, remaining=\d+, reset=\d+/);
            expect(res.headers.get('ratelimit-policy')).toMatch(/\d+;w=\d+/);
        });

        it('returns JSON from /api/hello', async () => {
            const ip = `test-hello-${String(Date.now())}`;
            const res = await fetch(`${baseUrl}/api/hello`, { headers: { 'x-forwarded-for': ip } });
            const body = (await res.json()) as Record<string, unknown>;

            expect(res.status).toBe(200);
            expect(body).toHaveProperty('hello', 'world');
        });

        it('returns JSON from /api/data', async () => {
            const ip = `test-data-${String(Date.now())}`;
            const res = await fetch(`${baseUrl}/api/data`, { headers: { 'x-forwarded-for': ip } });
            const body = (await res.json()) as Record<string, unknown>;

            expect(res.status).toBe(200);
            expect(body).toHaveProperty('items');
        });

        it('returns 429 after exceeding the limit', async () => {
            const ip = `test-burst-${String(Date.now())}`;
            const headers = { 'x-forwarded-for': ip };

            // Examples are configured with limit: 5
            for (let i = 0; i < 5; i++) {
                const res = await fetch(rootUrl, { headers });
                expect(res.status).toBe(200);
            }

            const limited = await fetch(rootUrl, { headers });
            expect(limited.status).toBe(429);

            const body = await limited.text();
            expect(body).toBe('Too Many Requests');
        });

        it('includes rate limit headers on 429 responses', async () => {
            const ip = `test-429-headers-${String(Date.now())}`;
            const headers = { 'x-forwarded-for': ip };

            for (let i = 0; i < 5; i++) {
                await fetch(rootUrl, { headers });
            }

            const limited = await fetch(rootUrl, { headers });
            expect(limited.status).toBe(429);
            expect(limited.headers.get('ratelimit')).toMatch(/remaining=0/);
        });
    });
}
