'use client';

import { useState } from 'react';

interface ActionBarProps {
    onSend: () => void;
    onBurst: (count: number) => void;
    onReset: () => void;
    onClear: () => void;
    isSending: boolean;
    burstRemaining: number;
}

const BURST_OPTIONS = [5, 10, 15, 25];

export function ActionBar({ onSend, onBurst, onReset, onClear, isSending, burstRemaining }: ActionBarProps) {
    const [showBurstMenu, setShowBurstMenu] = useState(false);

    return (
        <div className="flex flex-wrap items-center gap-2">
            {/* Send Request */}
            <button
                onClick={onSend}
                disabled={isSending}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 transition-colors"
            >
                {isSending && burstRemaining === 0 ? 'Sending...' : 'Send Request'}
            </button>

            {/* Send Burst */}
            <div className="relative">
                <button
                    onClick={() => {
                        setShowBurstMenu(!showBurstMenu);
                    }}
                    disabled={isSending}
                    className="rounded-lg border border-blue-600 bg-transparent px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-950 transition-colors"
                >
                    {burstRemaining > 0 ? `Burst (${String(burstRemaining)} left)` : 'Send Burst'}
                    <svg className="ml-1 -mr-1 inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
                {showBurstMenu && !isSending && (
                    <div className="absolute top-full left-0 z-10 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                        {BURST_OPTIONS.map(count => (
                            <button
                                key={count}
                                onClick={() => {
                                    setShowBurstMenu(false);
                                    onBurst(count);
                                }}
                                className="block w-full px-4 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                                {String(count)} requests
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="h-6 w-px bg-gray-300 dark:bg-gray-700" />

            {/* Reset */}
            <button
                onClick={onReset}
                disabled={isSending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
            >
                Reset
            </button>

            {/* Clear Log */}
            <button
                onClick={onClear}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
            >
                Clear Log
            </button>
        </div>
    );
}
