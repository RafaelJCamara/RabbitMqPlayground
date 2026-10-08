import { AmqpSession } from './amqp-session';
import type { BrokerSession } from './session';

/** Which broker the fixtures were, or are being, recorded on. */
export interface BrokerInfo {
  readonly image: string;
  readonly imageDigest: string;
  readonly serverVersion: string;
  readonly erlangVersion: string;
}

/** A running broker that can hand out one isolated session per scenario. */
export interface LiveBroker {
  readonly info: BrokerInfo;
  /** Creates the vhost, connects to it, and, when the session is closed, deletes the vhost. */
  openSession(vhost: string): Promise<BrokerSession>;
  /**
   * Imports a definitions file (the export of the app, ADR-0079) as the management UI does, which creates the vhost that the file names, connects to it, and, when the session is closed, deletes
   * the vhost. What the file declares is there already, so the session is for playing what is done after it.
   */
  openImportedSession(vhost: string, definitions: string): Promise<BrokerSession>;
  stop(): Promise<void>;
}

const CREDENTIALS = { username: 'guest', password: 'guest' } as const;

/** The little of RabbitMQ's management HTTP API that the runner needs. */
export class ManagementApi {
  constructor(
    private readonly baseUrl: string,
    private readonly retry: { readonly attempts: number; readonly delayMs: number } = { attempts: 30, delayMs: 1_000 },
  ) {}

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    return this.send(method, path, body === undefined ? undefined : JSON.stringify(body));
  }

  /** A request whose body is the text that is given, as it is: a definitions file is sent as it was written. */
  private async send(method: string, path: string, text?: string): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/api/${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${CREDENTIALS.username}:${CREDENTIALS.password}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      ...(text === undefined ? {} : { body: text }),
    });
    if (!response.ok) {
      throw new Error(`${method} /api/${path} answered ${response.status}: ${await response.text()}`);
    }
    return response;
  }

  async createVhost(vhost: string): Promise<void> {
    await this.request('PUT', `vhosts/${encodeURIComponent(vhost)}`);
    await this.request('PUT', `permissions/${encodeURIComponent(vhost)}/${CREDENTIALS.username}`, {
      configure: '.*',
      write: '.*',
      read: '.*',
    });
  }

  /**
   * Imports a definitions file, the way the management UI's "Import definitions" does: to the broker, which creates the vhosts that the file names. The file is sent as it is written, because
   * a float that is written `1.0` must reach the broker as `1.0`. The user gets full permissions on the vhost, as on one that was made by `createVhost`.
   */
  async importDefinitions(vhost: string, definitions: string): Promise<void> {
    await this.send('POST', 'definitions', definitions);
    await this.request('PUT', `permissions/${encodeURIComponent(vhost)}/${CREDENTIALS.username}`, {
      configure: '.*',
      write: '.*',
      read: '.*',
    });
  }

  async deleteVhost(vhost: string): Promise<void> {
    await this.request('DELETE', `vhosts/${encodeURIComponent(vhost)}`);
  }

  /** Waits for the management listener, which can come up a moment after the broker says it has started. */
  async overview(): Promise<{ rabbitmqVersion: string; erlangVersion: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.retry.attempts; attempt++) {
      try {
        const body = (await (await this.request('GET', 'overview')).json()) as {
          rabbitmq_version: string;
          erlang_version: string;
        };
        return { rabbitmqVersion: body.rabbitmq_version, erlangVersion: body.erlang_version };
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, this.retry.delayMs));
      }
    }
    throw new Error(`The management API did not come up: ${String(lastError)}`);
  }
}

export interface BrokerAddress {
  readonly hostname: string;
  readonly amqpPort: number;
  readonly managementUrl: string;
  readonly image: string;
  readonly imageDigest: string;
  readonly stop?: () => Promise<void>;
}

/** Connects to a broker that is already running, wherever it is, and describes it. */
export async function connectBroker(address: BrokerAddress): Promise<LiveBroker> {
  const management = new ManagementApi(address.managementUrl);
  const { rabbitmqVersion, erlangVersion } = await management.overview();

  return {
    info: {
      image: address.image,
      imageDigest: address.imageDigest,
      serverVersion: rabbitmqVersion,
      erlangVersion,
    },
    async openSession(vhost) {
      await management.createVhost(vhost);
      return AmqpSession.connect({ hostname: address.hostname, port: address.amqpPort, vhost, ...CREDENTIALS }, () =>
        management.deleteVhost(vhost),
      );
    },
    async openImportedSession(vhost, definitions) {
      await management.importDefinitions(vhost, definitions);
      return AmqpSession.connect({ hostname: address.hostname, port: address.amqpPort, vhost, ...CREDENTIALS }, () =>
        management.deleteVhost(vhost),
      );
    },
    stop: async () => address.stop?.(),
  };
}
