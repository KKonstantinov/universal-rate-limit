'use client';

import { useState, useEffect, useRef } from 'react';
import { formatDuration } from '../lib/format-utils';
import { getSecondsUntilBoundary, getWindowIndex } from '../lib/window-utils';

interface EpochWindowTimerProps {
    windowMs: number;
}

export function EpochWindowTimer({ windowMs }: EpochWindowTimerProps) {
    const [secondsLeft, setSecondsLeft] = useState(() => getSecondsUntilBoundary(windowMs));
    const [flash, setFlash] = useState(false);
    const windowIndexRef = useRef(getWindowIndex(windowMs));
    const flashTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        setSecondsLeft(getSecondsUntilBoundary(windowMs));
        windowIndexRef.current = getWindowIndex(windowMs);
    }, [windowMs]);

    useEffect(() => {
        const interval = setInterval(() => {
            const next = getSecondsUntilBoundary(windowMs);
            const currentIndex = getWindowIndex(windowMs);

            if (currentIndex !== windowIndexRef.current) {
                windowIndexRef.current = currentIndex;
                setFlash(true);
                clearTimeout(flashTimeoutRef.current);
                flashTimeoutRef.current = setTimeout(() => {
                    setFlash(false);
                }, 1000);
            }

            setSecondsLeft(next);
        }, 200);

        return () => {
            clearInterval(interval);
            clearTimeout(flashTimeoutRef.current);
        };
    }, [windowMs]);

    return (
        <span className={`transition-colors duration-500 ${flash ? 'text-green-500' : secondsLeft <= 3 ? 'text-red-500' : ''}`}>
            {formatDuration(secondsLeft, Math.ceil(windowMs / 1000) >= 60)}
        </span>
    );
}
