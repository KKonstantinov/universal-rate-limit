'use client';

import { useState, useEffect } from 'react';
import type { RequestLogEntry } from '../lib/types';
import { getWindowWeight } from '../lib/window-utils';

interface SlidingWindowDiagramProps {
    entry: RequestLogEntry;
    windowMs: number;
    limit: number;
}

interface WindowState {
    weight: number;
    prevHits: number;
    currHits: number;
}

function computeWindowState(entry: RequestLogEntry, windowMs: number): WindowState {
    const now = Date.now();
    const resetMs = new Date(entry.resetTime).getTime();

    if (now < resetMs) {
        const elapsed = now - (resetMs - windowMs);
        const weight = getWindowWeight(elapsed, windowMs);
        return { weight, prevHits: entry.previousWindowHits, currHits: entry.currentWindowHits };
    }

    // Past resetTime — current hits became "previous" in the new window and are decaying
    const weight = getWindowWeight(now - resetMs, windowMs);
    return { weight, prevHits: entry.currentWindowHits, currHits: 0 };
}

export function SlidingWindowDiagram({ entry, windowMs, limit }: SlidingWindowDiagramProps) {
    const [state, setState] = useState(() => computeWindowState(entry, windowMs));

    useEffect(() => {
        setState(computeWindowState(entry, windowMs));
        const interval = setInterval(() => {
            setState(computeWindowState(entry, windowMs));
        }, 200);
        return () => {
            clearInterval(interval);
        };
    }, [entry, windowMs]);

    const { weight, prevHits, currHits } = state;
    const bracketLeft = (1 - weight) * 50;
    const weightedTotal = prevHits * weight + currHits;
    const weightedPrev = prevHits * weight;

    return (
        <div className="space-y-1.5">
            {/* Window labels */}
            <div className="flex text-[10px] font-medium">
                <div className="w-1/2 text-center text-amber-600/70 dark:text-amber-400/70">Previous Window</div>
                <div className="w-1/2 text-center text-blue-600/70 dark:text-blue-400/70">Current Window</div>
            </div>

            {/* Timeline: tinted regions with centered hit counts + sliding bracket */}
            <div className="relative">
                <div className="flex h-8 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                    {/* Previous window region */}
                    <div className="w-1/2 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
                        {prevHits > 0 && (
                            <span className="text-sm font-bold tabular-nums text-amber-600/50 dark:text-amber-400/40">
                                {String(prevHits)}
                            </span>
                        )}
                    </div>
                    {/* Current window region */}
                    <div className="w-1/2 bg-blue-50 dark:bg-blue-950/30 border-l border-gray-200 dark:border-gray-700 flex items-center justify-center">
                        {currHits > 0 && (
                            <span className="text-sm font-bold tabular-nums text-blue-600/50 dark:text-blue-400/40">
                                {String(currHits)}
                            </span>
                        )}
                    </div>
                </div>

                {/* Sliding window bracket overlay */}
                <div
                    className="absolute inset-y-0 rounded-lg pointer-events-none transition-all duration-200 bg-indigo-500/[0.08] dark:bg-indigo-400/[0.12] ring-2 ring-inset ring-indigo-500/50 dark:ring-indigo-400/50"
                    style={{ left: `${String(bracketLeft)}%`, width: '50%' }}
                />
            </div>

            {/* Weighted breakdown */}
            <div className="flex items-center justify-center gap-1.5 text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-indigo-600/70 dark:text-indigo-400/70">Sliding Window</span>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span>
                    {prevHits > 0
                        ? `${String(prevHits)} x ${weight.toFixed(2)} + ${String(currHits)} = ${weightedTotal.toFixed(1)}`
                        : `${String(currHits)} hit${currHits === 1 ? '' : 's'}`}
                    {' / '}
                    {String(limit)}
                </span>
                {prevHits > 0 && (
                    <>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        <span className="text-amber-600/60 dark:text-amber-400/50">prev: {weightedPrev.toFixed(1)}</span>
                        <span className="text-blue-600/60 dark:text-blue-400/50">curr: {String(currHits)}</span>
                    </>
                )}
            </div>
        </div>
    );
}
