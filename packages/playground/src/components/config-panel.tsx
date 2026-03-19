'use client';

import type { PlaygroundConfig } from '../lib/types';

interface ConfigPanelProps {
    config: PlaygroundConfig;
    onChange: (updates: Partial<PlaygroundConfig>) => void;
    disabled: boolean;
}

const WINDOW_PRESETS = [
    { label: '10s', value: 10_000 },
    { label: '30s', value: 30_000 },
    { label: '1m', value: 60_000 },
    { label: '5m', value: 300_000 }
];

export function ConfigPanel({ config, onChange, disabled }: ConfigPanelProps) {
    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Configuration</h2>
            <div className="flex flex-wrap gap-4">
                {/* Limit */}
                <div className="w-20">
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Limit</label>
                    <input
                        type="number"
                        min={1}
                        max={100}
                        value={config.limit}
                        onChange={e => {
                            onChange({ limit: Math.max(1, Math.min(100, Number(e.target.value) || 1)) });
                        }}
                        disabled={disabled}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm tabular-nums dark:border-gray-700 dark:bg-gray-800 disabled:opacity-50"
                    />
                </div>

                {/* Window */}
                <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Window</label>
                    <div className="flex gap-1">
                        {WINDOW_PRESETS.map(preset => (
                            <button
                                key={preset.value}
                                onClick={() => {
                                    onChange({ windowMs: preset.value });
                                }}
                                disabled={disabled}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                    config.windowMs === preset.value
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                                } border border-gray-300 dark:border-gray-700 disabled:opacity-50`}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Algorithm */}
                <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Algorithm</label>
                    <div className="flex gap-1">
                        {(['fixed-window', 'sliding-window'] as const).map(algo => (
                            <button
                                key={algo}
                                onClick={() => {
                                    onChange({ algorithm: algo });
                                }}
                                disabled={disabled}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                    config.algorithm === algo
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                                } border border-gray-300 dark:border-gray-700 disabled:opacity-50`}
                            >
                                {algo === 'fixed-window' ? 'Fixed' : 'Sliding'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Header Format */}
                <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Headers</label>
                    <div className="flex gap-1">
                        {(['draft-7', 'draft-6'] as const).map(version => (
                            <button
                                key={version}
                                onClick={() => {
                                    onChange({ headers: version });
                                }}
                                disabled={disabled}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                    config.headers === version
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                                } border border-gray-300 dark:border-gray-700 disabled:opacity-50`}
                            >
                                {version === 'draft-7' ? 'Draft 7' : 'Draft 6'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Legacy Headers */}
                <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Legacy Headers</label>
                    <button
                        onClick={() => {
                            onChange({ legacyHeaders: !config.legacyHeaders });
                        }}
                        disabled={disabled}
                        className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                            config.legacyHeaders ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'
                        } disabled:opacity-50`}
                    >
                        <span
                            className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
                                config.legacyHeaders ? 'translate-x-7' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>
            </div>
        </div>
    );
}
