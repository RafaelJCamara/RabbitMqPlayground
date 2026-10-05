import { spawnSync } from 'node:child_process';
import { RabbitMQContainer } from '@testcontainers/rabbitmq';
import { getContainerRuntimeClient } from 'testcontainers';
import { connectBroker, type LiveBroker } from './management';

export type ContainerRuntime = { readonly available: true } | { readonly available: false; readonly reason: string };

/** Whether Docker (or a compatible runtime) can be used here. It is not in the cloud container this was written in. */
export async function detectContainerRuntime(): Promise<ContainerRuntime> {
  try {
    await getContainerRuntimeClient();
    return { available: true };
  } catch (error) {
    const reason = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
    return { available: false, reason };
  }
}

/** The content digest of a pulled image, which says exactly which build the fixtures were recorded on. */
function imageDigest(image: string): string {
  const result = spawnSync('docker', ['image', 'inspect', image, '--format', '{{json .RepoDigests}}'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return 'unknown';
  }
  try {
    const digests = JSON.parse(result.stdout) as string[];
    return digests[0] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Starts the pinned RabbitMQ image in a container (which Testcontainers removes again when the run ends). */
export async function startRabbitMq(image: string): Promise<LiveBroker> {
  const container = await new RabbitMQContainer(image).withStartupTimeout(180_000).start();

  return connectBroker({
    hostname: container.getHost(),
    amqpPort: container.getMappedPort(5672),
    managementUrl: `http://${container.getHost()}:${container.getMappedPort(15672)}`,
    image,
    imageDigest: imageDigest(image),
    stop: async () => {
      await container.stop();
    },
  });
}
