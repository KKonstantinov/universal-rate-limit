import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/integration/**/*.test.ts'],
        testTimeout: 30_000,
        hookTimeout: 60_000,
        teardownTimeout: 30_000
    }
});
