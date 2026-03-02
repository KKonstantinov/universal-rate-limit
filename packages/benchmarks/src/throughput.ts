/**
 * Throughput benchmark: measures rate-limit middleware operations per second
 * for @universal-rate-limit/express vs express-rate-limit.
 *
 * Methodology:
 * - Both libraries are tested as Express middleware (req, res, next).
 * - Both use their built-in in-memory stores.
 * - We call each middleware in a tight async loop with mock Express
 *   req/res/next objects, simulating N requests from a pool of unique IP keys.
 * - We measure wall-clock time for a fixed number of operations and derive ops/sec.
 * - Warm-up runs are discarded to avoid JIT compilation noise.
 */

import { expressRateLimit as universalExpressRateLimit } from '@universal-rate-limit/express';
import expressRateLimit from 'express-rate-limit';
import fs from 'node:fs';

// ── Configuration ────────────────────────────────────────────────────────────

const OPERATIONS = 100_000;
const WARMUP_OPS = 10_000;
const KEY_POOL_SIZE = 1000; // number of unique "clients"
const WINDOW_MS = 60_000;
const LIMIT = 1_000_000; // high limit so we measure throughput, not blocking

// ── Types ────────────────────────────────────────────────────────────────────

interface BenchResult {
    name: string;
    ops: number;
    elapsed: string;
    opsPerSec: number;
    avgUs: string;
}

interface MockExpressReq {
    ip: string;
    app: { get: () => boolean };
    headers: Record<string, string>;
    socket: { remoteAddress: string };
    method: string;
    url: string;
}

interface MockExpressRes {
    statusCode: number;
    headersSent: boolean;
    writableEnded: boolean;
    setHeader(k: string, v: string): void;
    getHeader(k: string): string | undefined;
    status(code: number): MockExpressRes;
    send(): MockExpressRes;
    append(k: string, v: string): void;
    on(): void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateKeys(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `192.168.1.${String(i % 256)}`);
}

// Mock Express request — identical for both libraries
function makeMockExpressReq(ip: string): MockExpressReq {
    return {
        ip,
        app: { get: () => false },
        headers: { 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
        method: 'GET',
        url: '/'
    };
}

// Mock Express response — identical for both libraries
function makeMockExpressRes(): MockExpressRes {
    const headers: Record<string, string> = {};
    const res: MockExpressRes = {
        statusCode: 200,
        headersSent: false,
        writableEnded: false,
        setHeader(k: string, v: string) {
            headers[k] = v;
        },
        getHeader(k: string) {
            return headers[k];
        },
        status(code: number) {
            res.statusCode = code;
            return res;
        },
        send() {
            res.writableEnded = true;
            return res;
        },
        append(k: string, v: string) {
            headers[k] = headers[k] ? `${headers[k]}, ${v}` : v;
        },
        on() {}
    };
    return res;
}

// ── Benchmark runner ─────────────────────────────────────────────────────────

async function bench(name: string, fn: (i: number) => Promise<void>, ops: number): Promise<BenchResult> {
    // Warmup
    for (let i = 0; i < WARMUP_OPS; i++) {
        await fn(i);
    }

    // Timed run
    const start = performance.now();
    for (let i = 0; i < ops; i++) {
        await fn(i);
    }
    const elapsed = performance.now() - start;
    const opsPerSec = Math.round((ops / elapsed) * 1000);
    const avgUs = ((elapsed / ops) * 1000).toFixed(2);

    return { name, ops, elapsed: elapsed.toFixed(1), opsPerSec, avgUs };
}

// ── Benchmarks ───────────────────────────────────────────────────────────────

async function benchmarkUniversalExpress(): Promise<BenchResult> {
    const keys = generateKeys(KEY_POOL_SIZE);
    const middleware = universalExpressRateLimit({
        windowMs: WINDOW_MS,
        limit: LIMIT
    });

    return bench(
        '@universal-rate-limit/express',
        async i => {
            const req = makeMockExpressReq(keys[i % KEY_POOL_SIZE]);
            const res = makeMockExpressRes();
            return new Promise<void>(resolve => {
                middleware(req as never, res as never, resolve);
            });
        },
        OPERATIONS
    );
}

async function benchmarkExpressRateLimit(): Promise<BenchResult> {
    const keys = generateKeys(KEY_POOL_SIZE);
    const middleware = expressRateLimit({
        windowMs: WINDOW_MS,
        limit: LIMIT,
        validate: false, // disable validations for fair comparison
        legacyHeaders: false,
        standardHeaders: 'draft-7'
    });

    return bench(
        'express-rate-limit',
        async i => {
            const ip = keys[i % KEY_POOL_SIZE];
            const req = makeMockExpressReq(ip);
            const res = makeMockExpressRes();
            return new Promise<void>(resolve => {
                middleware(req as never, res as never, resolve);
            });
        },
        OPERATIONS
    );
}

async function benchmarkUniversalExpressSingleKey(): Promise<BenchResult> {
    const middleware = universalExpressRateLimit({
        windowMs: WINDOW_MS,
        limit: LIMIT
    });
    const ip = '10.0.0.1';

    return bench(
        '@universal-rate-limit/express (single key)',
        async () => {
            const req = makeMockExpressReq(ip);
            const res = makeMockExpressRes();
            return new Promise<void>(resolve => {
                middleware(req as never, res as never, resolve);
            });
        },
        OPERATIONS
    );
}

async function benchmarkExpressRateLimitSingleKey(): Promise<BenchResult> {
    const middleware = expressRateLimit({
        windowMs: WINDOW_MS,
        limit: LIMIT,
        validate: false,
        legacyHeaders: false,
        standardHeaders: 'draft-7'
    });
    const ip = '10.0.0.1';

    return bench(
        'express-rate-limit (single key)',
        async () => {
            const req = makeMockExpressReq(ip);
            const res = makeMockExpressRes();
            return new Promise<void>(resolve => {
                middleware(req as never, res as never, resolve);
            });
        },
        OPERATIONS
    );
}

// ── Run all benchmarks ───────────────────────────────────────────────────────

console.log('Express Middleware Throughput Benchmark');
console.log('='.repeat(70));
console.log(`Operations: ${OPERATIONS.toLocaleString()} | Warmup: ${WARMUP_OPS.toLocaleString()} | Keys: ${String(KEY_POOL_SIZE)}`);
console.log('');

console.log('Running: multi-key benchmarks...');
const r1 = await benchmarkUniversalExpress();
const r2 = await benchmarkExpressRateLimit();

console.log('Running: single-key benchmarks...');
const r3 = await benchmarkUniversalExpressSingleKey();
const r4 = await benchmarkExpressRateLimitSingleKey();

const results: BenchResult[] = [r1, r2, r3, r4];

console.log('');
console.log('Results:');
console.log('-'.repeat(70));
console.log('Middleware'.padEnd(42), 'ops/sec'.padStart(10), 'avg (µs)'.padStart(10), 'total (ms)'.padStart(12));
console.log('-'.repeat(70));

for (const r of results) {
    console.log(r.name.padEnd(42), r.opsPerSec.toLocaleString().padStart(10), r.avgUs.padStart(10), r.elapsed.padStart(12));
}

console.log('-'.repeat(70));

// Output JSON for report consumption
const jsonPath = new URL('results.json', import.meta.url);
fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
console.log(`\nResults saved to results.json`);

process.exit(0);
