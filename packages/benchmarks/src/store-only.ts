/**
 * Store-only benchmark: isolates the raw MemoryStore.increment() performance
 * from request construction overhead.
 *
 * This gives the most accurate comparison of the core data structure performance.
 */

import { MemoryStore as UniversalMemoryStore } from 'universal-rate-limit';
import { MemoryStore as ExpressMemoryStore } from 'express-rate-limit';

// ── Configuration ────────────────────────────────────────────────────────────

const OPERATIONS = 500_000;
const WARMUP_OPS = 50_000;
const KEY_POOL_SIZE = 1000;
const WINDOW_MS = 60_000;

// ── Types ────────────────────────────────────────────────────────────────────

interface BenchResult {
    name: string;
    ops: number;
    elapsed: string;
    opsPerSec: number;
    avgNs: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateKeys(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `192.168.1.${String(i)}`);
}

async function bench(name: string, fn: (i: number) => unknown, ops: number): Promise<BenchResult> {
    for (let i = 0; i < WARMUP_OPS; i++) await fn(i);

    const start = performance.now();
    for (let i = 0; i < ops; i++) await fn(i);
    const elapsed = performance.now() - start;
    const opsPerSec = Math.round((ops / elapsed) * 1000);
    const avgNs = ((elapsed / ops) * 1_000_000).toFixed(0);

    return { name, ops, elapsed: elapsed.toFixed(1), opsPerSec, avgNs };
}

// ── Benchmarks ───────────────────────────────────────────────────────────────

async function benchUniversalStore(): Promise<BenchResult> {
    const keys = generateKeys(KEY_POOL_SIZE);
    const store = new UniversalMemoryStore(WINDOW_MS, 'fixed-window');
    const result = await bench('universal-rate-limit MemoryStore', i => store.increment(keys[i % KEY_POOL_SIZE]), OPERATIONS);
    store.shutdown();
    return result;
}

async function benchExpressStore(): Promise<BenchResult> {
    const keys = generateKeys(KEY_POOL_SIZE);
    const store = new ExpressMemoryStore();
    store.init({ windowMs: WINDOW_MS });
    const result = await bench('express-rate-limit MemoryStore', i => store.increment(keys[i % KEY_POOL_SIZE]), OPERATIONS);
    store.shutdown();
    return result;
}

async function benchUniversalStoreSlidingWindow(): Promise<BenchResult> {
    const keys = generateKeys(KEY_POOL_SIZE);
    const store = new UniversalMemoryStore(WINDOW_MS, 'sliding-window');
    const result = await bench('universal MemoryStore (sliding window)', i => store.increment(keys[i % KEY_POOL_SIZE]), OPERATIONS);
    store.shutdown();
    return result;
}

// ── Run ──────────────────────────────────────────────────────────────────────

console.log('MemoryStore.increment() Benchmark');
console.log('='.repeat(70));
console.log(`Operations: ${OPERATIONS.toLocaleString()} | Warmup: ${WARMUP_OPS.toLocaleString()} | Keys: ${String(KEY_POOL_SIZE)}`);
console.log('');

const results: BenchResult[] = [await benchUniversalStore(), await benchExpressStore(), await benchUniversalStoreSlidingWindow()];

console.log('Results:');
console.log('-'.repeat(70));
console.log('Store'.padEnd(40), 'ops/sec'.padStart(12), 'avg (ns)'.padStart(10), 'total (ms)'.padStart(12));
console.log('-'.repeat(70));
for (const r of results) {
    console.log(r.name.padEnd(40), r.opsPerSec.toLocaleString().padStart(12), r.avgNs.padStart(10), r.elapsed.padStart(12));
}
console.log('-'.repeat(70));

process.exit(0);
