/**
 * Express middleware benchmark: measures real HTTP request throughput
 * through both rate limiters mounted on Express.
 *
 * Methodology:
 * - Spins up two Express servers (one per limiter) on random ports.
 * - Uses fetch (Node built-in) to send N sequential HTTP requests.
 * - Runs 3 rounds, alternating which library goes first each round,
 *   to eliminate JIT / ordering bias.
 * - Reports the median result for each library across all rounds.
 */

import express from 'express';
import { expressRateLimit as universalExpressRateLimit } from '@universal-rate-limit/express';
import expressRateLimitPkg from 'express-rate-limit';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// ── Configuration ────────────────────────────────────────────────────────────

const REQUESTS = 10_000;
const WARMUP_REQUESTS = 3000;
const ROUNDS = 3;
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

function median(values: number[]): number {
    // eslint-disable-next-line unicorn/no-array-sort -- in-place sort on a disposable copy
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

// ── Run ──────────────────────────────────────────────────────────────────────

console.log('Express Middleware HTTP Benchmark');
console.log('='.repeat(70));
console.log(`Requests: ${REQUESTS.toLocaleString()} | Warmup: ${WARMUP_REQUESTS.toLocaleString()} | Rounds: ${String(ROUNDS)}`);
console.log('');

const universalApp = createUniversalApp();
const expressApp = createExpressRateLimitApp();

const { server: s1, port: p1 } = await startServer(universalApp);
const { server: s2, port: p2 } = await startServer(expressApp);

const universalResults: BenchResult[] = [];
const expressResults: BenchResult[] = [];

for (let round = 1; round <= ROUNDS; round++) {
    const universalFirst = round % 2 === 1;
    const order = universalFirst ? 'universal first' : 'express-rate-limit first';
    console.log(`Round ${String(round)}/${String(ROUNDS)} (${order})`);

    if (universalFirst) {
        console.log('  Running: @universal-rate-limit/express...');
        universalResults.push(await benchServer('@universal-rate-limit/express', p1, REQUESTS, WARMUP_REQUESTS));
        console.log('  Running: express-rate-limit...');
        expressResults.push(await benchServer('express-rate-limit', p2, REQUESTS, WARMUP_REQUESTS));
    } else {
        console.log('  Running: express-rate-limit...');
        expressResults.push(await benchServer('express-rate-limit', p2, REQUESTS, WARMUP_REQUESTS));
        console.log('  Running: @universal-rate-limit/express...');
        universalResults.push(await benchServer('@universal-rate-limit/express', p1, REQUESTS, WARMUP_REQUESTS));
    }
}

s1.close();
s2.close();

// ── Per-round details ────────────────────────────────────────────────────────

console.log('');
console.log('Per-round details:');
console.log('-'.repeat(70));
console.log('Round'.padEnd(8), 'Library'.padEnd(35), 'req/sec'.padStart(10), 'avg (ms)'.padStart(10));
console.log('-'.repeat(70));

for (let i = 0; i < ROUNDS; i++) {
    const u = universalResults[i];
    const e = expressResults[i];
    console.log(String(i + 1).padEnd(8), u.name.padEnd(35), u.reqPerSec.toLocaleString().padStart(10), u.avgMs.padStart(10));
    console.log(''.padEnd(8), e.name.padEnd(35), e.reqPerSec.toLocaleString().padStart(10), e.avgMs.padStart(10));
}

// ── Median results ───────────────────────────────────────────────────────────

const medianUniversal = median(universalResults.map(r => r.reqPerSec));
const medianExpress = median(expressResults.map(r => r.reqPerSec));

console.log('');
console.log('Median results:');
console.log('-'.repeat(70));
console.log('Library'.padEnd(35), 'req/sec'.padStart(10));
console.log('-'.repeat(70));
console.log('@universal-rate-limit/express'.padEnd(35), medianUniversal.toLocaleString().padStart(10));
console.log('express-rate-limit'.padEnd(35), medianExpress.toLocaleString().padStart(10));
console.log('-'.repeat(70));

process.exit(0);
