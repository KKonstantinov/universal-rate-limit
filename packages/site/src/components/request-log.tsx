'use client';

import type { RequestLogEntry } from '../lib/types';
import { RequestEntry } from './request-entry';

interface RequestLogProps {
    log: RequestLogEntry[];
}

export function RequestLog({ log }: RequestLogProps) {
    if (log.length === 0) {
        return (
            <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                <p className="text-sm text-gray-400 dark:text-gray-600">No requests yet. Click &quot;Send Request&quot; to get started.</p>
            </div>
        );
    }

    return (
        <div className="log-scroll max-h-96 overflow-y-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/50">
            {log.map(entry => (
                <RequestEntry key={entry.id} entry={entry} />
            ))}
        </div>
    );
}
