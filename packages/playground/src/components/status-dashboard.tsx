'use client';

import { useState, useEffect } from 'react';
import type { Algorithm } from 'universal-rate-limit';
import type { RequestLogEntry } from '../lib/types';
import { CountdownTimer } from './countdown-timer';
import { RecoveryTimer } from './recovery-timer';
import { RetryAfterTimer } from './retry-after-timer';

interface StatusDashboardProps {
    latestEntry: RequestLogEntry | null;
    windowMs: number;
    algorithm: Algorithm;
}

/**
 * Project the sliding-window remaining value at the current moment.
 *
 * Three phases:
 * 1. Previous hits decaying (within current window) — weight decreases, remaining increases.
 * 2. Before resetTime with only current hits — remaining stays flat (no decay within a window).
 * 3. Past resetTime — current hits became "previous" in the new window and start decaying.
 */
function interpolateRemaining(entry: RequestLogEntry, windowMs: number): number {
    const now = Date.now();
    const resetMs = new Date(entry.resetTime).getTime();

    if (now < resetMs) {
        // Still in the original window
        if (entry.previousWindowHits === 0) {
            // Only current window hits — no decay yet
            return entry.remaining;
        }
        // Previous hits are decaying
        const windowStart = resetMs - windowMs;
        const elapsed = now - windowStart;
        const weight = Math.max(0, 1 - elapsed / windowMs);
        const interpolatedHits = Math.ceil(entry.previousWindowHits * weight + entry.currentWindowHits);
        return Math.max(0, entry.limit - interpolatedHits);
    }

    // Past resetTime — current hits have become "previous" in the new window
    // and are now decaying. Previous hits from the original window are fully decayed (weight = 0 at resetTime).
    const elapsedInNewWindow = now - resetMs;
    const weight = Math.max(0, 1 - elapsedInNewWindow / windowMs);
    const decayingHits = Math.ceil(entry.currentWindowHits * weight);
    return Math.max(0, Math.min(entry.limit, entry.limit - decayingHits));
}

export function StatusDashboard({ latestEntry, windowMs, algorithm }: StatusDashboardProps) {
    const [interpolatedRemaining, setInterpolatedRemaining] = useState<number | null>(null);
    const [windowExpired, setWindowExpired] = useState(false);

    // Sliding window: interpolate remaining in real-time
    useEffect(() => {
        if (!latestEntry || algorithm !== 'sliding-window') {
            setInterpolatedRemaining(null);
            return;
        }

        const totalHits = latestEntry.currentWindowHits + latestEntry.previousWindowHits;
        if (totalHits === 0) {
            setInterpolatedRemaining(null);
            return;
        }

        setInterpolatedRemaining(interpolateRemaining(latestEntry, windowMs));

        const interval = setInterval(() => {
            setInterpolatedRemaining(interpolateRemaining(latestEntry, windowMs));
        }, 200);

        return () => {
            clearInterval(interval);
        };
    }, [latestEntry, windowMs, algorithm]);

    // Fixed window: detect when resetTime passes and reset the display
    useEffect(() => {
        if (!latestEntry || algorithm !== 'fixed-window') {
            setWindowExpired(false);
            return;
        }

        const resetMs = new Date(latestEntry.resetTime).getTime();
        const delay = resetMs - Date.now();

        if (delay <= 0) {
            setWindowExpired(true);
            return;
        }

        setWindowExpired(false);
        const timeout = setTimeout(() => {
            setWindowExpired(true);
        }, delay);

        return () => {
            clearTimeout(timeout);
        };
    }, [latestEntry, algorithm]);

    const limit = latestEntry?.limit ?? 0;
    const resetTime = latestEntry?.resetTime ?? null;

    const remaining = interpolatedRemaining ?? (windowExpired ? limit : (latestEntry?.remaining ?? 0));
    const limited = interpolatedRemaining === null ? (windowExpired ? false : (latestEntry?.limited ?? false)) : remaining <= 0;

    const ratio = limit > 0 ? remaining / limit : 1;
    const barColor = limited ? 'bg-red-500' : ratio > 0.5 ? 'bg-green-500' : ratio > 0.2 ? 'bg-yellow-500' : 'bg-red-500';

    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
            <div className="flex flex-wrap items-center gap-6">
                {/* Remaining / Limit */}
                <div className="flex-1 min-w-48">
                    <div className="mb-1 flex items-baseline justify-between">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Remaining</span>
                        <span className="text-sm tabular-nums font-semibold">
                            {latestEntry ? `${String(remaining)} / ${String(limit)}` : '-- / --'}
                        </span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                        <div
                            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                            style={{ width: latestEntry ? `${String(ratio * 100)}%` : '100%' }}
                        />
                    </div>
                </div>

                {/* Countdown / Recovery / Retry After */}
                <div className="text-center min-w-24">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        {algorithm === 'sliding-window' ? (limited ? 'Retry After' : 'Full Recovery') : 'Window Reset'}
                        <span
                            className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-gray-400 text-[10px] leading-none text-gray-400 dark:border-gray-500 dark:text-gray-500"
                            title={
                                algorithm === 'sliding-window'
                                    ? limited
                                        ? 'Time until the server will accept requests again, based on the Retry-After response header.'
                                        : 'Time until all request quota is fully restored. In a sliding window, hits decay gradually — current window hits become "previous" at the window boundary, then take another full window to fully decay. Full recovery can take up to 2x the window duration.'
                                    : 'Time until the current fixed window expires and the request counter resets to zero. All quota is restored instantly at this point.'
                            }
                        >
                            ?
                        </span>
                    </span>
                    <div className="text-lg font-mono font-bold tabular-nums">
                        {latestEntry ? (
                            algorithm === 'sliding-window' ? (
                                limited ? (
                                    <RetryAfterTimer entry={latestEntry} />
                                ) : (
                                    <RecoveryTimer entry={latestEntry} windowMs={windowMs} />
                                )
                            ) : (
                                resetTime && <CountdownTimer resetTime={resetTime} windowMs={windowMs} />
                            )
                        ) : (
                            '--:--'
                        )}
                    </div>
                </div>

                {/* Status Badge */}
                <div>
                    {latestEntry ? (
                        limited ? (
                            <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                RATE LIMITED
                            </span>
                        ) : (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                OK
                            </span>
                        )
                    ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-200 px-3 py-1 text-sm font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            IDLE
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
