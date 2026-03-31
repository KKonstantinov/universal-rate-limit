import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Playground',
    description: 'Interactive playground for experimenting with rate limiting algorithms, headers, and configuration.'
};

export default function PlaygroundLayout({ children }: Readonly<{ children: ReactNode }>) {
    return children;
}
