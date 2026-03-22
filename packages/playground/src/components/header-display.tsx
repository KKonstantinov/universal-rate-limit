'use client';

interface HeaderDisplayProps {
    headers: Record<string, string>;
}

const RATE_LIMIT_HEADERS = new Set([
    'ratelimit',
    'ratelimit-policy',
    'ratelimit-limit',
    'ratelimit-remaining',
    'ratelimit-reset',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'retry-after'
]);

export function HeaderDisplay({ headers }: HeaderDisplayProps) {
    const entries = Object.entries(headers);
    if (entries.length === 0) return null;

    return (
        <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800">
                        <th className="px-3 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-400">Header</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-400">Value</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map(([key, value]) => {
                        const isRateLimit = RATE_LIMIT_HEADERS.has(key.toLowerCase());
                        return (
                            <tr key={key} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                                <td
                                    className={`px-3 py-1 font-mono ${
                                        isRateLimit ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'
                                    }`}
                                >
                                    {key}
                                </td>
                                <td className="px-3 py-1 font-mono text-gray-800 dark:text-gray-200">{value}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
