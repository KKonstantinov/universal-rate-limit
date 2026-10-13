import { withRateLimit } from '@universal-rate-limit/nextjs';

// Dynamic route: withRateLimit forwards Next.js's route context, so params are available
async function handler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return Response.json({ id });
}

export const GET = withRateLimit(handler, {
    algorithm: { type: 'sliding-window', windowMs: 60_000 }, // 1 minute
    limit: 5 // 5 requests per window (low for demo purposes)
});
