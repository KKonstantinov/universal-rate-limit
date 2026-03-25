'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Shared countdown timer state: polls `getSeconds` every 200 ms and flashes
 * green when the value first reaches zero.
 *
 * Pass a **stable** `getSeconds` callback (via `useCallback` in the consumer)
 * — the hook resets whenever the callback identity changes.
 */
export function useCountdownTimer(getSeconds: () => number): { secondsLeft: number; flash: boolean } {
    const getSecondsRef = useRef(getSeconds);
    getSecondsRef.current = getSeconds;

    const [secondsLeft, setSecondsLeft] = useState(() => getSeconds());
    const [flash, setFlash] = useState(false);
    const flashTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const hasFlashedRef = useRef(false);

    // Reset when upstream deps change (callback identity)
    useEffect(() => {
        setSecondsLeft(getSeconds());
        hasFlashedRef.current = false;
        setFlash(false);
    }, [getSeconds]);

    // 200 ms polling interval
    useEffect(() => {
        const interval = setInterval(() => {
            const next = getSecondsRef.current();
            setSecondsLeft(next);

            if (next === 0 && !hasFlashedRef.current) {
                hasFlashedRef.current = true;
                setFlash(true);
                clearTimeout(flashTimeoutRef.current);
                flashTimeoutRef.current = setTimeout(() => {
                    setFlash(false);
                }, 1000);
            }
        }, 200);

        return () => {
            clearInterval(interval);
            clearTimeout(flashTimeoutRef.current);
        };
    }, [getSeconds]);

    return { secondsLeft, flash };
}
