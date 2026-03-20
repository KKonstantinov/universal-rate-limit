'use client';

import { useCallback } from 'react';
import type { RequestLogEntry } from '../lib/types';
import { formatDuration } from '../lib/format-utils';
import { useCountdownTimer } from '../hooks/use-countdown-timer';

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
    const getSeconds = useCallback(() => secondsUntilRecovered(entry, windowMs), [entry, windowMs]);
    const { secondsLeft, flash } = useCountdownTimer(getSeconds);

    if (secondsLeft === 0) {
        return (
            <span className={`transition-colors duration-500 ${flash ? 'text-green-500' : 'text-gray-400 dark:text-gray-600'}`}>--</span>
        );
    }

    return (
        <span className={`transition-colors duration-500 ${secondsLeft <= 3 ? 'text-red-500' : ''}`}>{formatDuration(secondsLeft)}</span>
    );
}
