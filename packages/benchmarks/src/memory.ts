/**
 * Memory benchmark: measures heap usage when storing many unique keys.
 *
 * Methodology:
 * - Force GC before and after populating the store with N unique keys.
 * - Measure heapUsed delta to determine per-key memory cost.
 * - Tests both universal-rate-limit MemoryStore and express-rate-limit MemoryStore.
 *
 * Run with: node --expose-gc dist/memory.mjs
 */

import { MemoryStore as UniversalMemoryStore } from 'universal-rate-limit';
import expressRateLimit from 'express-rate-limit';
import fs from 'node:fs';

// ── Configuration ────────────────────────────────────────────────────────────

const KEY_COUNT = 100_000;
const WINDOW_MS = 60_000;

// ── Types ────────────────────────────────────────────────────────────────────

interface MemoryResult {
    name: string;
    total: number;
    perKey: number;
    formatted: string;
    perKeyFormatted: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function forceGC(): void {
    if (globalThis.gc) {
        globalThis.gc();
        globalThis.gc();
    } else {
        console.warn('Warning: run with --expose-gc for accurate memory measurements');
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${String(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Universal-rate-limit MemoryStore ─────────────────────────────────────────

function benchUniversalMemory(): MemoryResult {
    forceGC();
    const before = process.memoryUsage().heapUsed;

    const store = new UniversalMemoryStore(WINDOW_MS);
    for (let i = 0; i < KEY_COUNT; i++) {
        store.increment(`key-${String(i)}`);
    }

    forceGC();
    const after = process.memoryUsage().heapUsed;
    const delta = after - before;
    const perKey = delta / KEY_COUNT;

    store.shutdown();
    return {
        name: 'universal-rate-limit MemoryStore',
        total: delta,
        perKey,
        formatted: formatBytes(delta),
        perKeyFormatted: formatBytes(perKey)
    };
}

// ── Express-rate-limit MemoryStore ───────────────────────────────────────────

async function benchExpressMemory(): Promise<MemoryResult> {
    forceGC();
    const before = process.memoryUsage().heapUsed;

    // Create express-rate-limit to get its internal MemoryStore
    // We access it by creating the middleware and using its store via increment
    const middleware = expressRateLimit({
        windowMs: WINDOW_MS,
        limit: KEY_COUNT + 1,
        validate: false,
        legacyHeaders: false,
        standardHeaders: false
    });

    // Access the store directly - express-rate-limit exposes resetKey, which proves the store exists.
    // We simulate requests to populate the store.
    for (let i = 0; i < KEY_COUNT; i++) {
        const req = {
            ip: `key-${String(i)}`,
            app: { get: () => false },
            headers: {},
            socket: { remoteAddress: `key-${String(i)}` },
            method: 'GET',
            url: '/'
        };
        const res = {
            statusCode: 200,
            headersSent: false,
            writableEnded: false,
            setHeader() {},
            getHeader() {},
            status(c: number) {
                res.statusCode = c;
                return res;
            },
            send() {
                res.writableEnded = true;
                return res;
            },
            append() {},
            on() {}
        };
        await new Promise<void>(resolve => middleware(req as never, res as never, resolve));
    }

    forceGC();
    const after = process.memoryUsage().heapUsed;
    const delta = after - before;
    const perKey = delta / KEY_COUNT;

    return {
        name: 'express-rate-limit MemoryStore',
        total: delta,
        perKey,
        formatted: formatBytes(delta),
        perKeyFormatted: formatBytes(perKey)
    };
}

// ── Run ──────────────────────────────────────────────────────────────────────

console.log('Memory Usage Benchmark');
console.log('='.repeat(60));
console.log(`Keys: ${KEY_COUNT.toLocaleString()} | Window: ${String(WINDOW_MS)}ms`);
console.log('');

const results: MemoryResult[] = [benchUniversalMemory(), await benchExpressMemory()];

console.log('Results:');
console.log('-'.repeat(60));
console.log('Store'.padEnd(35), 'Total'.padStart(10), 'Per Key'.padStart(12));
console.log('-'.repeat(60));

for (const r of results) {
    console.log(r.name.padEnd(35), r.formatted.padStart(10), r.perKeyFormatted.padStart(12));
}

console.log('-'.repeat(60));

// Save results
fs.writeFileSync(new URL('memory-results.json', import.meta.url), JSON.stringify(results, null, 2));
console.log('\nResults saved to memory-results.json');

process.exit(0);
