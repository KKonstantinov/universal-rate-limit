import { resetByIp, getClientIp, checkApiRateLimit } from '../../../lib/limiter-cache';

export async function POST(request: Request) {
    const blocked = await checkApiRateLimit(request);
    if (blocked) return blocked;

    resetByIp(getClientIp(request));

    return Response.json({ ok: true });
}
