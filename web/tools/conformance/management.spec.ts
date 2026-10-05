import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManagementApi } from './management';

interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

let server: Server;
let seen: Seen[];
let respond: (request: Seen) => { status: number; body?: unknown };
let baseUrl: string;

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = '';
    request.on('data', (chunk: Buffer) => (text += chunk.toString()));
    request.on('end', () => resolve(text));
  });

beforeEach(async () => {
  seen = [];
  respond = () => ({ status: 204 });
  server = createServer((request, response) => {
    void readBody(request).then((body) => {
      const call = {
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        body,
      };
      seen.push(call);
      const { status, body: payload } = respond(call);
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(payload === undefined ? undefined : JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('ManagementApi', () => {
  const api = () => new ManagementApi(baseUrl, { attempts: 3, delayMs: 5 });

  it('creates a vhost and gives guest full permissions on it, with basic authentication', async () => {
    await api().createVhost('conformance-routing-x');

    expect(seen.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'PUT /api/vhosts/conformance-routing-x',
      'PUT /api/permissions/conformance-routing-x/guest',
    ]);
    expect(seen[0]?.authorization).toBe(`Basic ${Buffer.from('guest:guest').toString('base64')}`);
    expect(JSON.parse(seen[1]?.body ?? '')).toEqual({ configure: '.*', write: '.*', read: '.*' });
  });

  it('encodes a vhost name that needs it', async () => {
    await api().createVhost('a b/c');

    expect(seen[0]?.url).toBe('/api/vhosts/a%20b%2Fc');
    expect(seen[1]?.url).toBe('/api/permissions/a%20b%2Fc/guest');
  });

  it('deletes a vhost, which also closes its connections', async () => {
    await api().deleteVhost('v');

    expect(seen.map(({ method, url }) => `${method} ${url}`)).toEqual(['DELETE /api/vhosts/v']);
  });

  it('says what the broker answered when a request fails', async () => {
    respond = () => ({ status: 401, body: { error: 'not_authorised' } });

    await expect(api().createVhost('v')).rejects.toThrow('PUT /api/vhosts/v answered 401: {"error":"not_authorised"}');
  });

  it('reads the broker and Erlang versions from the overview', async () => {
    respond = () => ({ status: 200, body: { rabbitmq_version: '4.3.6', erlang_version: '27.3.4', other: 1 } });

    await expect(api().overview()).resolves.toEqual({ rabbitmqVersion: '4.3.6', erlangVersion: '27.3.4' });
  });

  it('waits for the management listener, trying again until it answers', async () => {
    let calls = 0;
    respond = () =>
      ++calls < 3 ? { status: 503 } : { status: 200, body: { rabbitmq_version: '4.3.6', erlang_version: '27' } };

    await expect(api().overview()).resolves.toMatchObject({ rabbitmqVersion: '4.3.6' });
    expect(calls).toBe(3);
  });

  it('gives up after its attempts, and says why', async () => {
    respond = () => ({ status: 503 });

    await expect(api().overview()).rejects.toThrow(/did not come up: Error: GET \/api\/overview answered 503/);
    expect(seen).toHaveLength(3);
  });
});
