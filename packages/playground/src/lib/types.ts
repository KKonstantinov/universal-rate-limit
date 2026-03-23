import type { HeadersVersion } from 'universal-rate-limit';

/** Algorithm names supported by the playground UI. */
export type AlgorithmName = 'fixed-window' | 'sliding-window' | 'token-bucket';

export interface PlaygroundConfig {
    limit: number;
    windowMs: number;
    algorithm: AlgorithmName;
    headers: HeadersVersion;
    legacyHeaders: boolean;
    refillRate?: number;
}

export interface RequestLogEntry {
    id: number;
    status: number;
    limited: boolean;
    limit: number;
    remaining: number;
    resetTime: string;
    headers: Record<string, string>;
    responseTimeMs: number;
    timestamp: number;
    currentWindowHits: number;
    previousWindowHits: number;
}
