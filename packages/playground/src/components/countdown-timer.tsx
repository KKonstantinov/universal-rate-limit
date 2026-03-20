'use client';

import { useCallback } from 'react';
import { formatDuration } from '../lib/format-utils';
import { useCountdownTimer } from '../hooks/use-countdown-timer';

interface CountdownTimerProps {
    resetTime: string;
    windowMs: number;
}

export function CountdownTimer({ resetTime, windowMs }: CountdownTimerProps) {
    const getSeconds = useCallback(() => {
        const diff = new Date(resetTime).getTime() - Date.now();
        return Math.max(0, Math.ceil(diff / 1000));
    }, [resetTime]);

    const { secondsLeft, flash } = useCountdownTimer(getSeconds);

    if (secondsLeft === 0) {
        return (
            <span className={`transition-colors duration-500 ${flash ? 'text-green-500' : 'text-gray-400 dark:text-gray-600'}`}>--</span>
        );
    }

    return (
        <span className={`transition-colors duration-500 ${secondsLeft <= 3 ? 'text-red-500' : ''}`}>
            {formatDuration(secondsLeft, Math.ceil(windowMs / 1000) >= 60)}
        </span>
    );
}
