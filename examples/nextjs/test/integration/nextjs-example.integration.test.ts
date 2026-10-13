import { describe, it, expect } from 'vitest';
import { rateLimitIntegrationSuite } from '../../../shared/integration-suite.js';

rateLimitIntegrationSuite('nextjs', { basePath: '/api/hello' });

describe('nextjs dynamic route (/api/users/[id])', () => {
    it('passes route params through withRateLimit to the handler', async () => {
        const baseUrl = process.env['TEST_BASE_URL'];
        const res = await fetch(`${String(baseUrl)}/api/users/42`, { headers: { 'x-forwarded-for': `test-params-${String(Date.now())}` } });

        expect(res.status).toBe(200);
        expect(res.headers.get('ratelimit')).toBeTruthy();
        expect(await res.json()).toEqual({ id: '42' });
    });
});
