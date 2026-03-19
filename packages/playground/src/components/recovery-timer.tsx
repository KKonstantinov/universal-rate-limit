'use client';

import { useState, useEffect, useRef } from 'react';
import type { RequestLogEntry } from '../lib/types';

interface RecoveryTimerProps {
    entry: RequestLogEntry;
    windowMs: number;
}

function secondsUntilRecovered(entry: RequestLogEntry, windowMs: number): number {
    const now = Date.now();
    const resetMs = new Date(entry.resetTime).getTime();

    if (entry.previousWindowHits === 0 && entry.currentWindowHits === 0) {
        return 0;
    }

    // Current hits will become "previous" at resetTime and decay over the next window
    const fullRecoveryMs = entry.currentWindowHits > 0 ? resetMs + windowMs : resetMs;

    return Math.max(0, Math.ceil((fullRecoveryMs - now) / 1000));
}

export function RecoveryTimer({ entry, windowMs }: RecoveryTimerProps) {
    const [secondsLeft, setSecondsLeft] = useState(() => secondsUntilRecovered(entry, windowMs));
    const [flash, setFlash] = useState(false);
    const flashTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
    const hasFlashed = useRef(false);

    useEffect(() => {
        setSecondsLeft(secondsUntilRecovered(entry, windowMs));
        hasFlashed.current = false;
        setFlash(false);
    }, [entry, windowMs]);

    useEffect(() => {
        const interval = setInterval(() => {
            const next = secondsUntilRecovered(entry, windowMs);
            setSecondsLeft(next);

            if (next === 0 && !hasFlashed.current) {
                hasFlashed.current = true;
                setFlash(true);
                flashTimeout.current = setTimeout(() => {
                    setFlash(false);
                }, 1000);
            }
        }, 200);

        return () => {
            clearInterval(interval);
            clearTimeout(flashTimeout.current);
        };
    }, [entry, windowMs]);

    if (secondsLeft === 0) {
        return (
            <span className={`transition-colors duration-500 ${flash ? 'text-green-500' : 'text-gray-400 dark:text-gray-600'}`}>--</span>
        );
    }

    const minutes = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;

    return (
        <span className={`transition-colors duration-500 ${secondsLeft <= 3 ? 'text-red-500' : ''}`}>
            {minutes > 0 ? `${String(minutes)}:${String(secs).padStart(2, '0')}` : `${String(secondsLeft)}s`}
        </span>
    );
}
