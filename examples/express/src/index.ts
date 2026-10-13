import express from 'express';
import { expressRateLimit } from '@universal-rate-limit/express';

const app = express();

// Trust a reverse proxy on the same host, so req.ip (the default rate limit key)
// is the client from X-Forwarded-For. Set this to match your real proxy setup.
app.set('trust proxy', 'loopback');

app.use(
    expressRateLimit({
        algorithm: { type: 'sliding-window', windowMs: 60_000 }, // 1 minute
        limit: 5 // 5 requests per window (low for demo purposes)
    })
);

app.get('/', (_req, res) => {
    res.json({ message: 'Hello from Express!' });
});

app.get('/api/hello', (_req, res) => {
    res.json({ hello: 'world' });
});

app.get('/api/data', (_req, res) => {
    res.json({ items: ['one', 'two', 'three'] });
});

const port = Number(process.env['PORT'] ?? 3000);
const server = app.listen(port, () => {
    console.log(`Express example listening on http://localhost:${String(port)}`);
});

export { app, server };
