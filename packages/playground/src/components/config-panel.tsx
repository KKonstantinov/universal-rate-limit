'use client';

import type { PlaygroundConfig } from '../lib/types';
import { ToggleButton } from './toggle-button';

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

const REFILL_PERIOD_PRESETS = [
    { label: '/sec', value: 1000 },
    { label: '/10s', value: 10_000 },
    { label: '/30s', value: 30_000 },
    { label: '/min', value: 60_000 }
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

                {/* Window (hidden for token-bucket) */}
                {config.algorithm !== 'token-bucket' && (
                    <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Window</label>
                        <div className="flex gap-1">
                            {WINDOW_PRESETS.map(preset => (
                                <ToggleButton
                                    key={preset.value}
                                    active={config.windowMs === preset.value}
                                    onClick={() => {
                                        onChange({ windowMs: preset.value });
                                    }}
                                    disabled={disabled}
                                >
                                    {preset.label}
                                </ToggleButton>
                            ))}
                        </div>
                    </div>
                )}

                {/* Refill Rate + Period (token-bucket only) */}
                {config.algorithm === 'token-bucket' && (
                    <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Refill Rate</label>
                        <div className="flex gap-1">
                            <input
                                type="number"
                                min={1}
                                max={100}
                                value={config.refillRate ?? 1}
                                onChange={e => {
                                    onChange({ refillRate: Math.max(1, Math.min(100, Number(e.target.value) || 1)) });
                                }}
                                disabled={disabled}
                                className="w-20 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm tabular-nums dark:border-gray-700 dark:bg-gray-800 disabled:opacity-50"
                            />
                            {REFILL_PERIOD_PRESETS.map(preset => (
                                <ToggleButton
                                    key={preset.value}
                                    active={(config.refillMs ?? 1000) === preset.value}
                                    onClick={() => {
                                        onChange({ refillMs: preset.value });
                                    }}
                                    disabled={disabled}
                                >
                                    {preset.label}
                                </ToggleButton>
                            ))}
                        </div>
                    </div>
                )}

                {/* Algorithm */}
                <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Algorithm</label>
                    <div className="flex gap-1">
                        {(['fixed-window', 'sliding-window', 'token-bucket'] as const).map(algo => (
                            <ToggleButton
                                key={algo}
                                active={config.algorithm === algo}
                                onClick={() => {
                                    onChange({ algorithm: algo });
                                }}
                                disabled={disabled}
                            >
                                {algo === 'fixed-window' ? 'Fixed' : algo === 'sliding-window' ? 'Sliding' : 'Token Bucket'}
                            </ToggleButton>
                        ))}
                    </div>
                </div>

                {/* Header Format */}
                <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Headers</label>
                    <div className="flex gap-1">
                        {(['draft-7', 'draft-6'] as const).map(version => (
                            <ToggleButton
                                key={version}
                                active={config.headers === version}
                                onClick={() => {
                                    onChange({ headers: version });
                                }}
                                disabled={disabled}
                            >
                                {version === 'draft-7' ? 'Draft 7' : 'Draft 6'}
                            </ToggleButton>
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
