import type { ReactNode } from 'react';

export const metadata = {
    title: 'universal-rate-limit Next.js Example'
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
