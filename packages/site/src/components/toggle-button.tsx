import type { ReactNode } from 'react';

interface ToggleButtonProps {
    active: boolean;
    onClick: () => void;
    disabled: boolean;
    children: ReactNode;
}

export function ToggleButton({ active, onClick, disabled, children }: ToggleButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
            } border border-gray-300 dark:border-gray-700 disabled:opacity-50`}
        >
            {children}
        </button>
    );
}
