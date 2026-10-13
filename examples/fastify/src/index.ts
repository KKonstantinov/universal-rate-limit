import Fastify from 'fastify';
import { fastifyRateLimit } from '@universal-rate-limit/fastify';

// Trust a reverse proxy on the same host, so request.ip (the default rate limit key)
// is the client from X-Forwarded-For. Set this to match your real proxy setup.
const app = Fastify({ trustProxy: 'loopback' });

await app.register(fastifyRateLimit, {
    algorithm: { type: 'sliding-window', windowMs: 60_000 }, // 1 minute
    limit: 5 // 5 requests per window (low for demo purposes)
});

app.get('/', () => {
    return { message: 'Hello from Fastify!' };
});

app.get('/api/hello', () => {
    return { hello: 'world' };
});

app.get('/api/data', () => {
    return { items: ['one', 'two', 'three'] };
});

const port = Number(process.env['PORT'] ?? 3000);
const address = await app.listen({ port, host: '127.0.0.1' });
console.log(`Fastify example listening on ${address}`);

export { app };
