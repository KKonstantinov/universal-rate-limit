import { createMDX } from 'fumadocs-mdx/next';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    transpilePackages: ['universal-rate-limit', '@markdown-for-agents/nextjs'],
    images: {
        remotePatterns: [{ hostname: 'raw.githubusercontent.com' }, { hostname: 'img.shields.io' }],
        dangerouslyAllowSVG: true,
        contentDispositionType: 'attachment',
        contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;"
    }
};

const withMDX = createMDX();

export default withMDX(nextConfig);
