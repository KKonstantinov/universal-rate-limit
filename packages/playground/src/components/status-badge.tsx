import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'error' | 'idle';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
    success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    idle: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
};

interface StatusBadgeProps {
    variant: BadgeVariant;
    /** Extra classes for size/shape (e.g. `"rounded-full px-3 py-1 text-sm"`). */
    className?: string;
    children: ReactNode;
}

export function StatusBadge({ variant, className = '', children }: StatusBadgeProps) {
    return <span className={`inline-flex items-center font-semibold ${VARIANT_CLASSES[variant]} ${className}`}>{children}</span>;
}
