import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertChecksum,
  downloadTarball,
  fetchChecksum,
  parseChecksum,
} from '../../src/core/download.ts';
import { ChecksumMismatchError, DownloadError } from '../../src/errors.ts';

const TARBALL = readFileSync('test/fixtures/binaryen-stub.tar.gz');
const DIGEST = '32b663a2afcc9962d6d33a6e0739b8e8f1fdf818481c16596ed4470d250307c3';

type Handler = Parameters<typeof createServer>[1];

let server: Server | undefined;
let requests: string[] = [];

async function serve(handler: Handler): Promise<string> {
  requests = [];

  server = createServer((request, response) => {
    requests.push(request.url ?? '');
    handler?.(request, response);
  });

  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/binaryen.tar.gz`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });

  server = undefined;
});

async function withTempFile<T>(run: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'wasm-opt-dl-'));

  try {
    return await run(join(dir, 'out.tar.gz'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('checksum parsing', () => {
  it('reads the shasum format Binaryen publishes', () => {
    expect(parseChecksum(`${DIGEST}  binaryen-version_132-x86_64-linux.tar.gz\n`)).toBe(DIGEST);
  });

  it('rejects anything that is not a digest', () => {
    expect(() => parseChecksum('<html>404 Not Found</html>')).toThrow(ChecksumMismatchError);
  });

  it('flags a mismatch instead of trusting the download', () => {
    expect(() => assertChecksum(DIGEST, 'deadbeef', 'http://example.test')).toThrow(
      ChecksumMismatchError,
    );
  });
});

describe('http failure modes', () => {
  it('reports a 404 with the response body preview', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not Found');
    });

    const error = await withTempFile((path) =>
      downloadTarball('132', 'x86_64-linux', path, { env: { WASM_OPT_BINARY_URL: url } }).catch(
        (caught: unknown) => caught,
      ),
    );

    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).status).toBe(404);
    expect((error as DownloadError).bodyPreview).toBe('Not Found');
    expect(requests).toHaveLength(1);
  });

  it('recognises a proxy interstitial served with 200', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<html><body>Authentication required</body></html>');
    });

    const error = await withTempFile((path) =>
      downloadTarball('132', 'x86_64-linux', path, { env: { WASM_OPT_BINARY_URL: url } }).catch(
        (caught: unknown) => caught,
      ),
    );

    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).message).toMatch(/proxy or captive-portal/);
    expect((error as DownloadError).bodyPreview).toMatch(/Authentication required/);
  });

  it('retries a 500 and succeeds on the third attempt', async () => {
    let attempts = 0;

    const url = await serve((_request, response) => {
      attempts += 1;

      if (attempts < 3) {
        response.writeHead(500);
        response.end('upstream unavailable');
        return;
      }

      response.writeHead(200, { 'content-type': 'application/gzip' });
      response.end(TARBALL);
    });

    const digest = await withTempFile((path) =>
      downloadTarball('132', 'x86_64-linux', path, { env: { WASM_OPT_BINARY_URL: url } }),
    );

    expect(attempts).toBe(3);
    expect(digest).toBe(DIGEST);
  });

  it('detects a body that stops short of content-length', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': String(TARBALL.byteLength * 4),
      });
      response.write(TARBALL.subarray(0, 100));
      setTimeout(() => response.destroy(), 150);
    });

    const error = await withTempFile((path) =>
      downloadTarball('132', 'x86_64-linux', path, { env: { WASM_OPT_BINARY_URL: url } }).catch(
        (caught: unknown) => caught,
      ),
    );

    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).message).toMatch(/truncated|interrupted/);
  });

  it('retries a transfer that was cut short instead of giving up', async () => {
    let attempts = 0;

    const url = await serve((_request, response) => {
      attempts += 1;
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': String(TARBALL.byteLength),
      });

      if (attempts === 1) {
        response.write(TARBALL.subarray(0, 100));
        setTimeout(() => response.destroy(), 150);
        return;
      }

      response.end(TARBALL);
    });

    const digest = await withTempFile((path) =>
      downloadTarball('132', 'x86_64-linux', path, { env: { WASM_OPT_BINARY_URL: url } }),
    );

    expect(attempts).toBe(2);
    expect(digest).toBe(DIGEST);
  });

  it('survives a transfer slower than the timeout as long as it keeps moving', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': String(TARBALL.byteLength),
      });

      let offset = 0;

      const push = () => {
        if (offset >= TARBALL.byteLength) {
          response.end();
          return;
        }

        response.write(TARBALL.subarray(offset, offset + 64));
        offset += 64;
        setTimeout(push, 40);
      };

      push();
    });

    const digest = await withTempFile((path) =>
      downloadTarball('132', 'x86_64-linux', path, {
        env: { WASM_OPT_BINARY_URL: url, WASM_OPT_TIMEOUT: '400' },
      }),
    );

    expect(digest).toBe(DIGEST);
  });

  it('gives up when the transfer stalls mid-body', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': String(TARBALL.byteLength),
      });
      response.write(TARBALL.subarray(0, 64));
    });

    const error = await withTempFile((path) =>
      downloadTarball('132', 'x86_64-linux', path, {
        env: { WASM_OPT_BINARY_URL: url, WASM_OPT_TIMEOUT: '200' },
      }).catch((caught: unknown) => caught),
    );

    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).message).toMatch(/stalled/);
    expect(requests.length).toBe(3);
  });

  it('gives up after three attempts when the server never answers', async () => {
    const url = await serve(() => {});

    const error = await withTempFile((path) =>
      downloadTarball('132', 'x86_64-linux', path, {
        env: { WASM_OPT_BINARY_URL: url, WASM_OPT_TIMEOUT: '150' },
      }).catch((caught: unknown) => caught),
    );

    expect(error).toBeInstanceOf(DownloadError);
    expect(requests.length).toBe(3);
  });

  it('streams the checksum sibling asset', async () => {
    const url = await serve((request, response) => {
      if (request.url?.endsWith('.sha256')) {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(`${DIGEST}  binaryen.tar.gz\n`);
        return;
      }

      response.writeHead(404);
      response.end();
    });

    expect(await fetchChecksum('132', 'x86_64-linux', { WASM_OPT_BINARY_URL: url })).toBe(DIGEST);
  });

  it('honours WASM_OPT_SHA256 without a network round trip', async () => {
    expect(
      await fetchChecksum('132', 'x86_64-linux', {
        WASM_OPT_SHA256: `${DIGEST}  binaryen.tar.gz`,
      }),
    ).toBe(DIGEST);
  });
});
