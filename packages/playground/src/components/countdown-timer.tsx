'use client';

import { useState, useEffect, useRef } from 'react';

interface CountdownTimerProps {
    resetTime: string;
    windowMs: number;
}

export function CountdownTimer({ resetTime, windowMs }: CountdownTimerProps) {
    const [secondsLeft, setSecondsLeft] = useState(() => {
        const diff = new Date(resetTime).getTime() - Date.now();
        return Math.max(0, Math.ceil(diff / 1000));
    });
    const [flash, setFlash] = useState(false);
    const flashTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
    const hasFlashed = useRef(false);

    useEffect(() => {
        const diff = new Date(resetTime).getTime() - Date.now();
        setSecondsLeft(Math.max(0, Math.ceil(diff / 1000)));
        hasFlashed.current = false;
        setFlash(false);
    }, [resetTime]);

    useEffect(() => {
        const interval = setInterval(() => {
            const diff = new Date(resetTime).getTime() - Date.now();
            const next = Math.max(0, Math.ceil(diff / 1000));
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
    }, [resetTime, windowMs]);

    if (secondsLeft === 0) {
        return (
            <span className={`transition-colors duration-500 ${flash ? 'text-green-500' : 'text-gray-400 dark:text-gray-600'}`}>--</span>
        );
    }

    const totalSeconds = Math.ceil(windowMs / 1000);
    const minutes = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;

    return (
        <span className={`transition-colors duration-500 ${secondsLeft <= 3 ? 'text-red-500' : ''}`}>
            {totalSeconds >= 60 ? `${String(minutes)}:${String(secs).padStart(2, '0')}` : `${String(secondsLeft)}s`}
        </span>
    );
}
