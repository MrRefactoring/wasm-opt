import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { enableProxy } from '../../src/core/download.ts';

let proxy: Server | undefined;
let origin: Server | undefined;
let restore: (() => void) | null = null;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function close(server: Server | undefined): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function recordingProxy(seen: string[]): Server {
  const server = createServer((request, response) => {
    seen.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('via-proxy');
  });

  server.on('connect', (request, socket, head) => {
    seen.push(request.url ?? '');
    socket.pause();

    const [host, port] = (request.url ?? '').split(':');
    const upstream = connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n', () => {
        if (head.length > 0) {
          upstream.write(head);
        }

        upstream.pipe(socket);
        socket.pipe(upstream);
        socket.resume();
      });
    });

    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return server;
}

afterEach(async () => {
  restore?.();
  restore = null;
  await close(proxy);
  await close(origin);
  proxy = undefined;
  origin = undefined;
});

describe('proxy support', () => {
  it('does nothing when no proxy is configured', async () => {
    expect(await enableProxy({})).toBeNull();
  });

  it('actually routes requests through the proxy, not just past it', async () => {
    const seen: string[] = [];

    origin = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('from-origin');
    });

    const originPort = await listen(origin);
    proxy = recordingProxy(seen);
    const proxyPort = await listen(proxy);

    restore = await enableProxy({ HTTP_PROXY: `http://127.0.0.1:${proxyPort}` });
    expect(restore).not.toBeNull();

    const body = await (await fetch(`http://127.0.0.1:${originPort}/asset.tar.gz`)).text();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(String(originPort));
    expect(['from-origin', 'via-proxy']).toContain(body);
  });

  it('stops routing through the proxy once restored', async () => {
    const seen: string[] = [];

    origin = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('from-origin');
    });

    const originPort = await listen(origin);
    proxy = recordingProxy(seen);
    const proxyPort = await listen(proxy);

    const undo = await enableProxy({ HTTP_PROXY: `http://127.0.0.1:${proxyPort}` });
    undo?.();

    await (await fetch(`http://127.0.0.1:${originPort}/direct`)).text();

    expect(seen).toEqual([]);
  });

  it('promotes npm proxy settings before enabling', async () => {
    const env: NodeJS.ProcessEnv = { npm_config_proxy: 'http://127.0.0.1:1' };

    restore = await enableProxy(env);

    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:1');
  });

  it('never overrides an explicit HTTPS_PROXY', async () => {
    const env: NodeJS.ProcessEnv = {
      HTTPS_PROXY: 'http://explicit.test:3128',
      npm_config_https_proxy: 'http://npm.test:8080',
    };

    restore = await enableProxy(env);

    expect(env.HTTPS_PROXY).toBe('http://explicit.test:3128');
  });
});
