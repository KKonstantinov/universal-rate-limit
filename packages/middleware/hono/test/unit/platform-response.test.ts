import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { honoRateLimit } from '../../src/index.js';

const NativeResponse = Response;

// A runtime boundary double: Workers retains extra state (such as WebSocket/compression
// metadata) only when the initializer is the existing Response, rather than selected fields.
class RuntimeResponse extends NativeResponse {
    runtimeState: object | undefined;

    constructor(body?: ConstructorParameters<typeof NativeResponse>[0], init?: ResponseInit) {
        super(body, init);
        this.runtimeState = init instanceof RuntimeResponse ? init.runtimeState : undefined;
    }
}

afterEach(() => vi.unstubAllGlobals());

describe('runtime-specific response state', () => {
    it.each([false, true])('preserves the original Response initializer (limited=%s)', async limited => {
        vi.stubGlobal('Response', RuntimeResponse);
        const response = new RuntimeResponse('body', { status: limited ? 429 : 200 });
        const runtimeState = {};
        response.runtimeState = runtimeState;
        const app = new Hono();
        app.use('*', honoRateLimit({ limit: limited ? 0 : 1, handler: () => response }));
        app.get('/', () => response);
        const result = await app.request('/');
        expect(result.status).toBe(limited ? 429 : 200);
        expect(result).toBeInstanceOf(RuntimeResponse);
        expect((result as RuntimeResponse).runtimeState).toBe(runtimeState);
        expect(result.headers.get('RateLimit')).toBeTruthy();
        expect(await result.text()).toBe('body');
    });
});
