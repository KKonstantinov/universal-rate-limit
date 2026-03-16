import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    transpilePackages: ['universal-rate-limit', '@universal-rate-limit/nextjs']
};

export default nextConfig;
