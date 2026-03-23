'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { PlaygroundConfig, RequestLogEntry } from '../lib/types';

const DEFAULT_CONFIG: PlaygroundConfig = {
    limit: 10,
    windowMs: 10_000,
    algorithm: 'sliding-window',
    headers: 'draft-7',
    legacyHeaders: false
};

interface ApiResponse {
    status: number;
    limited: boolean;
    limit: number;
    remaining: number;
    resetTime: string;
    headers: Record<string, string>;
    responseTimeMs: number;
    currentWindowHits: number;
    previousWindowHits: number;
}

interface ApiError {
    error: string;
    message?: string;
}

export function useRateLimiter() {
    const [config, setConfig] = useState<PlaygroundConfig>(DEFAULT_CONFIG);
    const [log, setLog] = useState<RequestLogEntry[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [burstRemaining, setBurstRemaining] = useState(0);
    const [configStale, setConfigStale] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const nextId = useRef(1);
    const configRef = useRef(config);
    configRef.current = config;
    const configStaleRef = useRef(configStale);
    configStaleRef.current = configStale;

    // Reset server-side state on page load so refreshes start fresh
    useEffect(() => {
        void fetch('/api/reset', { method: 'POST' });
    }, []);

    const sendRequest = useCallback(async (): Promise<RequestLogEntry | null> => {
        const current = configRef.current;
        const params = new URLSearchParams({
            limit: String(current.limit),
            windowMs: String(current.windowMs),
            algorithm: current.algorithm,
            headers: current.headers,
            legacyHeaders: String(current.legacyHeaders),
            ...(current.algorithm === 'token-bucket'
                ? { refillRate: String(current.refillRate ?? 1), refillMs: String(current.refillMs ?? 1000) }
                : {})
        });

        try {
            const response = await fetch(`/api/rate-limit?${String(params)}`);
            // Bug 1 fix: consume body once, then branch on status
            const data = (await response.json()) as ApiResponse & ApiError;

            if (response.status === 409 && data.error === 'configChanged') {
                setConfigStale(true);
                return null;
            }

            const entry: RequestLogEntry = {
                id: nextId.current++,
                status: data.status,
                limited: data.limited,
                limit: data.limit,
                remaining: data.remaining,
                resetTime: data.resetTime,
                headers: data.headers,
                responseTimeMs: data.responseTimeMs,
                timestamp: Date.now(),
                currentWindowHits: data.currentWindowHits,
                previousWindowHits: data.previousWindowHits
            };

            setLog(prev => [entry, ...prev]);
            return entry;
        } catch (error) {
            console.error('[rate-limiter] request failed:', error);
            return null;
        }
    }, []);

    const sendSingle = useCallback(async () => {
        setIsSending(true);
        await sendRequest();
        setIsSending(false);
    }, [sendRequest]);

    const sendBurst = useCallback(
        async (count: number) => {
            setIsSending(true);
            setBurstRemaining(count);

            for (let i = 0; i < count; i++) {
                setBurstRemaining(count - i);
                const result = await sendRequest();
                // Stop burst if config became stale (409 specifically sets configStale)
                if (!result && configStaleRef.current) break;
                if (i < count - 1) {
                    await new Promise(resolve => {
                        setTimeout(resolve, 50);
                    });
                }
            }

            setBurstRemaining(0);
            setIsSending(false);
        },
        [sendRequest]
    );

    const resetStore = useCallback(async () => {
        setIsResetting(true);
        try {
            await fetch('/api/reset', { method: 'POST' });
        } catch (error) {
            console.error('[rate-limiter] reset failed:', error);
        }
        setConfigStale(false);
        setLog([]);
        nextId.current = 1;
        setIsResetting(false);
    }, []);

    const clearLog = useCallback(() => {
        setLog([]);
    }, []);

    const updateConfig = useCallback(async (updates: Partial<PlaygroundConfig>) => {
        // Bug 2 fix: update ref immediately so sendRequest always reads latest config
        const newConfig = { ...configRef.current, ...updates };
        configRef.current = newConfig;
        setConfig(newConfig);
        setConfigStale(false);
        // Bug 3 fix: block sends while reset is in flight
        setIsResetting(true);
        setLog([]);
        nextId.current = 1;
        try {
            await fetch('/api/reset', { method: 'POST' });
        } catch (error) {
            console.error('[rate-limiter] config reset failed:', error);
        }
        setIsResetting(false);
    }, []);

    return {
        config,
        updateConfig,
        log,
        isSending: isSending || isResetting,
        burstRemaining,
        configStale,
        sendSingle,
        sendBurst,
        resetStore,
        clearLog
    };
}
