import { withRateLimit } from '@universal-rate-limit/nextjs';

function handler() {
    return Response.json({ hello: 'world' });
}

export const GET = withRateLimit(handler, {
    windowMs: 60_000, // 1 minute
    limit: 5 // 5 requests per window (low for demo purposes)
});
