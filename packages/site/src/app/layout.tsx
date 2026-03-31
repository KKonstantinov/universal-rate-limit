import './globals.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const title = 'universal-rate-limit';
const description =
    'Web-standards-based rate limiting with pluggable stores and framework middleware. Zero dependencies, works everywhere.';

export const metadata: Metadata = {
    title: {
        default: title,
        template: `%s | ${title}`
    },
    description,
    openGraph: {
        type: 'website',
        title,
        description
    },
    twitter: {
        card: 'summary',
        title,
        description
    },
    icons: { icon: '/favicon.svg' }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className="flex min-h-screen flex-col">
                <RootProvider>{children}</RootProvider>
            </body>
        </html>
    );
}
