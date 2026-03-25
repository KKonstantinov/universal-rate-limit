'use client';

import { useRateLimiter } from '../hooks/use-rate-limiter';
import { ConfigPanel } from './config-panel';
import { StatusDashboard } from './status-dashboard';
import { ActionBar } from './action-bar';
import { RequestLog } from './request-log';

export function Playground() {
    const { config, updateConfig, log, isSending, burstRemaining, configStale, sendSingle, sendBurst, resetStore, clearLog } =
        useRateLimiter();

    const latestEntry = log[0] ?? null;

    return (
        <div>
            {/* Stale config banner */}
            {configStale && (
                <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/50">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                        The rate limit configuration was changed in another tab. Please refresh to continue.
                    </p>
                    <button
                        onClick={() => {
                            globalThis.location.reload();
                        }}
                        className="ml-4 shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition-colors"
                    >
                        Refresh
                    </button>
                </div>
            )}

            {/* Config */}
            <div className="mb-4">
                <ConfigPanel
                    config={config}
                    onChange={updates => {
                        void updateConfig(updates);
                    }}
                    disabled={isSending || configStale}
                />
            </div>

            {/* Status Dashboard */}
            <div className="mb-4">
                <StatusDashboard
                    latestEntry={latestEntry}
                    windowMs={config.windowMs}
                    algorithm={config.algorithm}
                    refillRate={config.refillRate}
                    refillMs={config.refillMs}
                />
            </div>

            {/* Action Bar */}
            <div className="mb-4">
                <ActionBar
                    onSend={() => {
                        void sendSingle();
                    }}
                    onBurst={count => {
                        void sendBurst(count);
                    }}
                    onReset={() => {
                        void resetStore();
                    }}
                    onClear={clearLog}
                    isSending={isSending || configStale}
                    burstRemaining={burstRemaining}
                />
            </div>

            {/* Request Log */}
            <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Request Log</h2>
                <RequestLog log={log} />
            </div>
        </div>
    );
}
