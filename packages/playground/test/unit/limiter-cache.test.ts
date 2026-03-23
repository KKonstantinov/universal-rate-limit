import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getClientIp, getLimiter, getStoreHits, resetByIp } from '../../src/lib/limiter-cache';
import type { PlaygroundConfig } from '../../src/lib/types';

function createRequest(ip?: string): Request {
    const headers: Record<string, string> = {};
    if (ip) headers['x-forwarded-for'] = ip;
    return new Request('http://localhost/', { headers });
}

function makeConfig(overrides: Partial<PlaygroundConfig> = {}): PlaygroundConfig {
    return {
        limit: 10,
        windowMs: 10_000,
        algorithm: 'fixed-window',
        headers: 'draft-7',
        legacyHeaders: false,
        ...overrides
    };
}

// Clean up the global cache between tests to avoid cross-contamination
beforeEach(() => {
    const g = globalThis as unknown as {
        __rateLimitCache?: Map<string, unknown>;
        __rateLimitCleanupTimer?: ReturnType<typeof setInterval>;
    };
    if (g.__rateLimitCache) {
        g.__rateLimitCache.clear();
    }
});

afterEach(() => {
    const g = globalThis as unknown as {
        __rateLimitCache?: Map<string, unknown>;
        __rateLimitCleanupTimer?: ReturnType<typeof setInterval>;
    };
    if (g.__rateLimitCache) {
        g.__rateLimitCache.clear();
    }
});

// ── getClientIp ─────────────────────────────────────────────────────────

describe('getClientIp', () => {
    it('extracts IP from x-forwarded-for', () => {
        const req = createRequest('1.2.3.4');
        expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('extracts the first IP from a comma-separated x-forwarded-for', () => {
        const req = new Request('http://localhost/', {
            headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }
        });
        expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('uses x-real-ip if x-forwarded-for is absent', () => {
        const req = new Request('http://localhost/', {
            headers: { 'x-real-ip': '10.0.0.1' }
        });
        expect(getClientIp(req)).toBe('10.0.0.1');
    });

    it('uses cf-connecting-ip if earlier headers are absent', () => {
        const req = new Request('http://localhost/', {
            headers: { 'cf-connecting-ip': '192.168.1.1' }
        });
        expect(getClientIp(req)).toBe('192.168.1.1');
    });

    it('uses fly-client-ip if earlier headers are absent', () => {
        const req = new Request('http://localhost/', {
            headers: { 'fly-client-ip': '172.16.0.1' }
        });
        expect(getClientIp(req)).toBe('172.16.0.1');
    });

    it('falls back to 127.0.0.1 when no IP headers are present', () => {
        const req = new Request('http://localhost/');
        expect(getClientIp(req)).toBe('127.0.0.1');
    });
});

// ── getLimiter ───────────────────────────────────────────────────────────

describe('getLimiter', () => {
    it('creates a new limiter for a new IP', () => {
        const config = makeConfig();
        const { limiter, configChanged } = getLimiter('10.0.0.1', config);
        expect(limiter).toBeTypeOf('function');
        expect(configChanged).toBe(false);
    });

    it('reuses existing limiter for same IP and config', () => {
        const config = makeConfig();
        const first = getLimiter('10.0.0.2', config);
        const second = getLimiter('10.0.0.2', config);
        expect(second.limiter).toBe(first.limiter);
        expect(second.configChanged).toBe(false);
    });

    it('detects config change for same IP with different config', () => {
        const config1 = makeConfig({ limit: 10 });
        getLimiter('10.0.0.3', config1);
        const config2 = makeConfig({ limit: 20 });
        const result = getLimiter('10.0.0.3', config2);
        expect(result.configChanged).toBe(true);
    });

    // ── Token bucket specific ──

    it('creates a token-bucket limiter', () => {
        const config = makeConfig({ algorithm: 'token-bucket', refillRate: 5 });
        const { limiter, configChanged } = getLimiter('10.0.0.4', config);
        expect(limiter).toBeTypeOf('function');
        expect(configChanged).toBe(false);
    });

    it('token-bucket limiter returns correct results', async () => {
        const config = makeConfig({ algorithm: 'token-bucket', refillRate: 10, limit: 5 });
        const { limiter } = getLimiter('10.0.0.5', config);
        const req = createRequest('10.0.0.5');
        const result = await limiter(req);

        expect(result.limited).toBe(false);
        expect(result.remaining).toBe(4); // 5 - 1 = 4
        expect(result.limit).toBe(5);
    });

    it('token-bucket limiter exhausts tokens and limits', async () => {
        const config = makeConfig({ algorithm: 'token-bucket', refillRate: 10, limit: 3 });
        const { limiter } = getLimiter('10.0.0.6', config);

        // Send 3 requests to exhaust all tokens
        for (let i = 0; i < 3; i++) {
            await limiter(createRequest('10.0.0.6'));
        }

        // 4th request should be limited
        const result = await limiter(createRequest('10.0.0.6'));
        expect(result.limited).toBe(true);
        expect(result.remaining).toBe(0);
    });

    it('detects config change when refillRate differs', () => {
        const config1 = makeConfig({ algorithm: 'token-bucket', refillRate: 5 });
        getLimiter('10.0.0.7', config1);
        const config2 = makeConfig({ algorithm: 'token-bucket', refillRate: 10 });
        const result = getLimiter('10.0.0.7', config2);
        expect(result.configChanged).toBe(true);
    });

    it('treats undefined refillRate as 1 (default)', () => {
        const config1 = makeConfig({ algorithm: 'token-bucket', refillRate: 1 });
        getLimiter('10.0.0.8', config1);
        const config2 = makeConfig({ algorithm: 'token-bucket' }); // refillRate undefined, defaults to 1
        const result = getLimiter('10.0.0.8', config2);
        expect(result.configChanged).toBe(false); // Should match since default is 1
    });

    it('detects config change when switching algorithm to token-bucket', () => {
        const config1 = makeConfig({ algorithm: 'fixed-window' });
        getLimiter('10.0.0.9', config1);
        const config2 = makeConfig({ algorithm: 'token-bucket', refillRate: 10 });
        const result = getLimiter('10.0.0.9', config2);
        expect(result.configChanged).toBe(true);
    });

    it('detects config change when switching from token-bucket to fixed-window', () => {
        const config1 = makeConfig({ algorithm: 'token-bucket', refillRate: 10 });
        getLimiter('10.0.0.10', config1);
        const config2 = makeConfig({ algorithm: 'fixed-window' });
        const result = getLimiter('10.0.0.10', config2);
        expect(result.configChanged).toBe(true);
    });
});

// ── getStoreHits ────────────────────────────────────────────────────────

describe('getStoreHits', () => {
    it('returns zeros for unknown IP', () => {
        const hits = getStoreHits('unknown-ip');
        expect(hits).toEqual({ currentWindowHits: 0, previousWindowHits: 0 });
    });

    it('returns hit counts for fixed-window', async () => {
        const config = makeConfig({ algorithm: 'fixed-window', limit: 10 });
        const { limiter } = getLimiter('10.0.0.20', config);
        await limiter(createRequest('10.0.0.20'));

        const hits = getStoreHits('10.0.0.20');
        expect(hits.currentWindowHits).toBe(1);
        expect(hits.previousWindowHits).toBe(0);
    });

    it('returns zeros for token-bucket (no window hit concept)', async () => {
        const config = makeConfig({ algorithm: 'token-bucket', refillRate: 10, limit: 10 });
        const { limiter } = getLimiter('10.0.0.21', config);
        await limiter(createRequest('10.0.0.21'));

        const hits = getStoreHits('10.0.0.21');
        expect(hits.currentWindowHits).toBe(0);
        expect(hits.previousWindowHits).toBe(0);
    });
});

// ── resetByIp ───────────────────────────────────────────────────────────

describe('resetByIp', () => {
    it('removes the cached entry for a given IP', async () => {
        const config = makeConfig({ algorithm: 'token-bucket', refillRate: 10 });
        const { limiter } = getLimiter('10.0.0.30', config);
        await limiter(createRequest('10.0.0.30'));

        resetByIp('10.0.0.30');

        // After reset, getLimiter should create a new entry (configChanged=false since it's a fresh entry)
        const result = getLimiter('10.0.0.30', config);
        expect(result.configChanged).toBe(false);
    });

    it('is a no-op for unknown IP', () => {
        // Should not throw
        resetByIp('nonexistent-ip');
    });

    it('restores full quota after reset', async () => {
        const config = makeConfig({ algorithm: 'token-bucket', refillRate: 10, limit: 3 });
        const { limiter } = getLimiter('10.0.0.31', config);

        // Exhaust all tokens
        for (let i = 0; i < 3; i++) {
            await limiter(createRequest('10.0.0.31'));
        }

        // Reset and create a new limiter
        resetByIp('10.0.0.31');
        const { limiter: newLimiter } = getLimiter('10.0.0.31', config);
        const result = await newLimiter(createRequest('10.0.0.31'));

        expect(result.limited).toBe(false);
        expect(result.remaining).toBe(2); // 3 - 1 = 2
    });
});
