import { withRateLimit } from '@universal-rate-limit/nextjs';

function handler() {
    return Response.json({ items: ['one', 'two', 'three'] });
}

export const GET = withRateLimit(handler, {
    algorithm: { type: 'sliding-window', windowMs: 60_000 }, // 1 minute
    limit: 5 // 5 requests per window (low for demo purposes)
});
