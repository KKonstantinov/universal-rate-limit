import type { Algorithm, HeadersVersion } from 'universal-rate-limit';

export interface PlaygroundConfig {
    limit: number;
    windowMs: number;
    algorithm: Algorithm;
    headers: HeadersVersion;
    legacyHeaders: boolean;
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
