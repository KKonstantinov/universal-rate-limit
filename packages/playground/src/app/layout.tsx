import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Playground — universal-rate-limit',
    description: 'Interactive playground for experimenting with rate limiting algorithms, headers, and configuration.'
};

const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}}catch(e){}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeScript }} />
            </head>
            <body className="bg-gray-50 text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">{children}</body>
        </html>
    );
}
