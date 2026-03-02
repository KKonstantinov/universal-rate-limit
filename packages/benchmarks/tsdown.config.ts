import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/throughput.ts', 'src/store-only.ts', 'src/memory.ts', 'src/express-middleware.ts'],
    external: [/^[^./]/]
});
