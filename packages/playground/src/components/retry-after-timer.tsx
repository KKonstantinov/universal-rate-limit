'use client';

import { useCallback } from 'react';
import type { RequestLogEntry } from '../lib/types';
import { useCountdownTimer } from '../hooks/use-countdown-timer';

interface RetryAfterTimerProps {
    entry: RequestLogEntry;
}

function getRetryAfterSeconds(entry: RequestLogEntry): number {
    const value = entry.headers['retry-after'] ?? entry.headers['Retry-After'];
    if (!value) return 0;

    const seconds = Number(value);
    if (Number.isNaN(seconds)) return 0;

    // Calculate remaining from when the entry was received
    const elapsed = (Date.now() - entry.timestamp) / 1000;
    return Math.max(0, Math.ceil(seconds - elapsed));
}

export function RetryAfterTimer({ entry }: RetryAfterTimerProps) {
    const getSeconds = useCallback(() => getRetryAfterSeconds(entry), [entry]);
    const { secondsLeft, flash } = useCountdownTimer(getSeconds);

    if (secondsLeft === 0) {
        return (
            <span className={`transition-colors duration-500 ${flash ? 'text-green-500' : 'text-gray-400 dark:text-gray-600'}`}>--</span>
        );
    }

    return <span className="text-red-600 dark:text-red-400">{`${String(secondsLeft)}s`}</span>;
}
