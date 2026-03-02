/**
 * Express middleware benchmark: measures real HTTP request throughput
 * through both rate limiters mounted on Express.
 *
 * Methodology:
 * - Spins up two Express servers (one per limiter) on random ports.
 * - Uses fetch (Node built-in) to send N sequential HTTP requests.
 * - Measures wall-clock time for all requests to complete.
 * - This tests the full middleware path: request parsing, key extraction,
 *   store increment, header setting, and response sending.
 */

import express from 'express';
import { expressRateLimit as universalExpressRateLimit } from '@universal-rate-limit/express';
import expressRateLimitPkg from 'express-rate-limit';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// ── Configuration ────────────────────────────────────────────────────────────

const REQUESTS = 10_000;
const WARMUP_REQUESTS = 1000;
const WINDOW_MS = 60_000;
const LIMIT = 1_000_000; // high limit so we measure throughput

// ── Types ────────────────────────────────────────────────────────────────────

interface BenchResult {
    name: string;
    requests: number;
    elapsed: string;
    reqPerSec: number;
    avgMs: string;
}

// ── App setup ────────────────────────────────────────────────────────────────

function createUniversalApp(): express.Express {
    const app = express();
    app.use(
        universalExpressRateLimit({
            windowMs: WINDOW_MS,
            limit: LIMIT
        })
    );
    app.get('/', (_req, res) => res.send('ok'));
    return app;
}

function createExpressRateLimitApp(): express.Express {
    const app = express();
    app.use(
        expressRateLimitPkg({
            windowMs: WINDOW_MS,
            limit: LIMIT,
            validate: false,
            legacyHeaders: false,
            standardHeaders: 'draft-7'
        })
    );
    app.get('/', (_req, res) => res.send('ok'));
    return app;
}

async function startServer(app: express.Express): Promise<{ server: Server; port: number }> {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({ server, port });
        });
    });
}

async function benchServer(name: string, port: number, requests: number, warmupRequests: number): Promise<BenchResult> {
    const url = `http://127.0.0.1:${String(port)}/`;

    // Warmup
    for (let i = 0; i < warmupRequests; i++) {
        const res = await fetch(url);
        await res.text();
    }

    // Timed run
    const start = performance.now();
    for (let i = 0; i < requests; i++) {
        const res = await fetch(url);
        await res.text();
    }
    const elapsed = performance.now() - start;
    const reqPerSec = Math.round((requests / elapsed) * 1000);
    const avgMs = (elapsed / requests).toFixed(3);

    return { name, requests, elapsed: elapsed.toFixed(0), reqPerSec, avgMs };
}

// ── Run ──────────────────────────────────────────────────────────────────────

console.log('Express Middleware HTTP Benchmark');
console.log('='.repeat(70));
console.log(`Requests: ${REQUESTS.toLocaleString()} | Warmup: ${WARMUP_REQUESTS.toLocaleString()}`);
console.log('');

const universalApp = createUniversalApp();
const expressApp = createExpressRateLimitApp();

const { server: s1, port: p1 } = await startServer(universalApp);
const { server: s2, port: p2 } = await startServer(expressApp);

console.log('Running: @universal-rate-limit/express...');
const r1 = await benchServer('@universal-rate-limit/express', p1, REQUESTS, WARMUP_REQUESTS);

console.log('Running: express-rate-limit...');
const r2 = await benchServer('express-rate-limit', p2, REQUESTS, WARMUP_REQUESTS);

s1.close();
s2.close();

console.log('');
console.log('Results:');
console.log('-'.repeat(70));
console.log('Library'.padEnd(35), 'req/sec'.padStart(10), 'avg (ms)'.padStart(10), 'total (ms)'.padStart(12));
console.log('-'.repeat(70));
for (const r of [r1, r2]) {
    console.log(r.name.padEnd(35), r.reqPerSec.toLocaleString().padStart(10), r.avgMs.padStart(10), r.elapsed.padStart(12));
}
console.log('-'.repeat(70));

process.exit(0);
