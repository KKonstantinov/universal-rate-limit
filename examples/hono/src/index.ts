import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { honoRateLimit } from '@universal-rate-limit/hono';

const app = new Hono();

app.use(
    honoRateLimit({
        windowMs: 60_000, // 1 minute
        limit: 5 // 5 requests per window (low for demo purposes)
    })
);

app.get('/', c => {
    return c.json({ message: 'Hello from Hono!' });
});

app.get('/api/hello', c => {
    return c.json({ hello: 'world' });
});

app.get('/api/data', c => {
    return c.json({ items: ['one', 'two', 'three'] });
});

const port = Number(process.env['PORT'] ?? 3000);
const server = serve({ fetch: app.fetch, port }, info => {
    console.log(`Hono example listening on http://localhost:${String(info.port)}`);
});

export { app, server };
