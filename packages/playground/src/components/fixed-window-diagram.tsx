'use client';

import { useState, useEffect, useRef } from 'react';

interface FixedWindowDiagramProps {
    windowMs: number;
    hits: number;
    limit: number;
    resetTime: string | null;
}

export function FixedWindowDiagram({ windowMs, hits, limit, resetTime }: FixedWindowDiagramProps) {
    const [elapsed, setElapsed] = useState(0);
    const [flash, setFlash] = useState(false);
    const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        if (!resetTime) {
            setElapsed(0);
            return;
        }

        const resetMs = new Date(resetTime).getTime();
        const windowStartMs = resetMs - windowMs;

        const updateElapsed = () => {
            const fraction = (Date.now() - windowStartMs) / windowMs;
            setElapsed(Math.min(1, Math.max(0, fraction)));
        };
        updateElapsed();

        const progressInterval = setInterval(updateElapsed, 250);

        const delay = resetMs - Date.now();
        let boundaryTimeout: ReturnType<typeof setTimeout> | undefined;
        if (delay > 0) {
            boundaryTimeout = setTimeout(() => {
                setFlash(true);
                clearTimeout(flashTimeoutRef.current);
                flashTimeoutRef.current = setTimeout(() => {
                    setFlash(false);
                }, 800);
            }, delay);
        }

        return () => {
            clearInterval(progressInterval);
            clearTimeout(boundaryTimeout);
            clearTimeout(flashTimeoutRef.current);
        };
    }, [resetTime, windowMs]);

    const limited = hits >= limit;

    return (
        <div className="space-y-1.5">
            {/* Label */}
            <div className="flex items-center justify-between text-[10px] font-medium text-emerald-600/70 dark:text-emerald-400/70">
                <span>Current Window</span>
                <span className="tabular-nums text-gray-500 dark:text-gray-400">
                    {String(hits)} / {String(limit)} hits
                </span>
            </div>

            {/* Timeline bar with "now" marker */}
            <div className="relative">
                <div
                    className={`h-8 rounded-lg overflow-hidden border transition-colors duration-500 ${flash ? 'border-green-400 dark:border-green-500' : 'border-gray-200 dark:border-gray-700'}`}
                >
                    {/* Elapsed time fill */}
                    <div
                        className={`h-full transition-colors duration-500 ${flash ? 'bg-green-100 dark:bg-green-900/30' : 'bg-emerald-50 dark:bg-emerald-950/30'}`}
                        style={{ width: `${String(elapsed * 100)}%` }}
                    />
                </div>

                {/* "Now" marker — vertical line at elapsed position */}
                <div
                    className="absolute top-0 h-full w-0.5 -translate-x-1/2 pointer-events-none transition-all duration-100 bg-emerald-500 dark:bg-emerald-400"
                    style={{ left: `${String(elapsed * 100)}%` }}
                />

                {/* Hit count centered in the elapsed region */}
                {hits > 0 && (
                    <div
                        className="absolute inset-y-0 flex items-center justify-center pointer-events-none"
                        style={{ left: 0, width: `${String(elapsed * 100)}%` }}
                    >
                        <span
                            className={`text-sm font-bold tabular-nums ${limited ? 'text-red-500/60 dark:text-red-400/50' : 'text-emerald-600/40 dark:text-emerald-400/30'}`}
                        >
                            {String(hits)}
                        </span>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-center gap-1.5 text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-emerald-600/70 dark:text-emerald-400/70">Fixed Window</span>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span>All {String(hits)} hits reset to 0 at window boundary</span>
            </div>
        </div>
    );
}
