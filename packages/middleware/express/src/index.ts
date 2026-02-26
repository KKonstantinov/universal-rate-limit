import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction, RequestHandler } from 'express';
import { rateLimit, buildRateLimitResponse } from 'universal-rate-limit';
import type { RateLimitOptions } from 'universal-rate-limit';

export type { RateLimitOptions, RateLimitResult, Store, IncrementResult, MemoryStore } from 'universal-rate-limit';

export interface ExpressRateLimitOptions extends RateLimitOptions {
    keyGenerator?: (request: Request) => string | Promise<string>;
}

function expressRequestToRequest(req: ExpressRequest): Request {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost';
    const url = `${protocol}://${host}${req.originalUrl}`;
    const headers = new Headers();

    for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
            headers.set(key, value);
        } else if (Array.isArray(value)) {
            for (const v of value) {
                headers.append(key, v);
            }
        }
    }

    return new Request(url, {
        method: req.method,
        headers
    });
}

export function expressRateLimit(options: ExpressRateLimitOptions = {}): RequestHandler {
    const limiter = rateLimit(options);

    return (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
        const webRequest = expressRequestToRequest(req);

        void (async () => {
            try {
                const result = await limiter(webRequest);

                // Set rate limit headers
                for (const [key, value] of Object.entries(result.headers)) {
                    res.setHeader(key, value);
                }

                if (result.limited) {
                    const response = await buildRateLimitResponse(webRequest, result, {
                        handler: options.handler,
                        message: options.message,
                        statusCode: options.statusCode
                    });

                    res.status(response.status);
                    const body = await response.text();
                    const contentType = response.headers.get('content-type');
                    if (contentType) {
                        res.setHeader('Content-Type', contentType);
                    }
                    res.send(body);
                    return;
                }

                next();
            } catch (error) {
                next(error);
            }
        })();
    };
}
