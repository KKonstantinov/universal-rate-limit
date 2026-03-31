'use client';

import { useState } from 'react';
import type { RequestLogEntry } from '../lib/types';
import { HeaderDisplay } from './header-display';
import { StatusBadge } from './status-badge';

interface RequestEntryProps {
    entry: RequestLogEntry;
}

function timeAgo(timestamp: number): string {
    const seconds = Math.round((Date.now() - timestamp) / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${String(seconds)}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes)}m ago`;
}

export function RequestEntry({ entry }: RequestEntryProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="border-b border-gray-100 last:border-0 dark:border-gray-800/50">
            <button
                onClick={() => {
                    setExpanded(!expanded);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
            >
                {/* Request number */}
                <span className="w-8 text-xs font-mono text-gray-400 dark:text-gray-600">#{String(entry.id)}</span>

                {/* Status badge */}
                <StatusBadge variant={entry.limited ? 'error' : 'success'} className="rounded px-2 py-0.5 text-xs font-bold">
                    {String(entry.status)}
                </StatusBadge>

                {/* Remaining / Limit */}
                <span className="text-sm tabular-nums text-gray-600 dark:text-gray-400">
                    {String(entry.remaining)}/{String(entry.limit)} remaining
                </span>

                {/* Response time */}
                <span className="text-xs tabular-nums text-gray-400 dark:text-gray-600">{String(entry.responseTimeMs)}ms</span>

                {/* Timestamp */}
                <span className="ml-auto text-xs text-gray-400 dark:text-gray-600">{timeAgo(entry.timestamp)}</span>

                {/* Expand icon */}
                <svg
                    className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {expanded && (
                <div className="px-3 pb-3">
                    <HeaderDisplay headers={entry.headers} />
                </div>
            )}
        </div>
    );
}
