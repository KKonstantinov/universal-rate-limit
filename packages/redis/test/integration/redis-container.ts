import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import type { SendCommandFn } from '../../src/index.js';

export interface RedisTestContext {
    container: StartedTestContainer;
    client: RedisClientType;
    sendCommand: SendCommandFn;
}

export async function startRedisContainer(): Promise<RedisTestContext> {
    const container = await new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
        .start();

    const host = container.getHost();
    const port = container.getMappedPort(6379);

    const client = createClient({ url: `redis://${host}:${String(port)}` }) as RedisClientType;
    await client.connect();

    const sendCommand: SendCommandFn = (...args: string[]) => client.sendCommand(args);

    return { container, client, sendCommand };
}

export async function stopRedisContainer(ctx: RedisTestContext): Promise<void> {
    await ctx.client.quit();
    await ctx.container.stop();
}
