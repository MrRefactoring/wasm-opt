import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readIntegrity } from '../../src/core/cache.ts';
import { fileChecksum } from '../../src/core/download.ts';
import { extractTarball, installExtracted } from '../../src/core/extract.ts';
import { currentTarget, WASM_TARGET } from '../../src/core/platform.ts';
import { resolveBinarySync } from '../../src/core/resolve.ts';
import { ChecksumMismatchError, VersionUnavailableError } from '../../src/errors.ts';
import { installBinary } from '../../src/install.ts';

const TARBALL = readFileSync('test/fixtures/binaryen-stub.tar.gz');
const DIGEST = '32b663a2afcc9962d6d33a6e0739b8e8f1fdf818481c16596ed4470d250307c3';

const target = currentTarget() ?? WASM_TARGET;

let server: Server | undefined;
let cacheHome = '';
let workDir = '';
let requests = 0;

async function serveArchive(digest: string): Promise<string> {
  requests = 0;

  server = createServer((request, response) => {
    requests += 1;

    if (request.url?.endsWith('.sha256')) {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(`${digest}  binaryen.tar.gz\n`);
      return;
    }

    response.writeHead(200, { 'content-type': 'application/gzip' });
    response.end(TARBALL);
  });

  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/binaryen.tar.gz`;
}

beforeEach(async () => {
  cacheHome = await mkdtemp(join(tmpdir(), 'wasm-opt-cache-'));
  workDir = await mkdtemp(join(tmpdir(), 'wasm-opt-cwd-'));
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });

  server = undefined;
  await rm(cacheHome, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
});

function env(url: string): NodeJS.ProcessEnv {
  return {
    WASM_OPT_VERSION: '999',
    WASM_OPT_CACHE_DIR: cacheHome,
    WASM_OPT_BINARY_URL: url,
  };
}

describe('installer', () => {
  it('installs only the executable and shared libraries', async () => {
    const url = await serveArchive(DIGEST);
    const result = await installBinary({ env: env(url) });

    expect(result.fromCache).toBe(false);
    expect(result.version).toBe('999');

    const dir = join(cacheHome, '999', target.key);
    expect(existsSync(join(dir, 'bin', target.executable))).toBe(true);

    const libraries = await readdir(join(dir, 'lib'));
    expect(libraries).not.toContain('libbinaryen.a');
    expect(libraries).not.toContain('binaryen.lib');

    if (target.kind === 'native') {
      expect(libraries).toContain('libbinaryen.dylib');
    } else {
      expect(await readdir(join(dir, 'bin'))).toContain('wasm-opt.wasm');
    }
  });

  it('records per-file digests and verifies them on the next run', async () => {
    const url = await serveArchive(DIGEST);
    await installBinary({ env: env(url) });

    const before = requests;
    const second = await installBinary({ env: env(url) });

    expect(second.fromCache).toBe(true);
    expect(requests).toBe(before);

    const integrity = readIntegrity(join(cacheHome, '999', target.key));
    expect(integrity?.tarballSha256).toBe(DIGEST);
    expect(Object.keys(integrity?.files ?? {})).toContain(`bin/${target.executable}`);
  });

  it('rejects an archive whose digest does not match the published checksum', async () => {
    const url = await serveArchive('0'.repeat(64));

    await expect(installBinary({ env: env(url) })).rejects.toBeInstanceOf(ChecksumMismatchError);
    expect(existsSync(join(cacheHome, '999', target.key, 'bin'))).toBe(false);
  });

  it('leaves the working directory untouched whatever the cwd is', async () => {
    const url = await serveArchive(DIGEST);
    const previous = process.cwd();

    try {
      process.chdir(workDir);
      await installBinary({ env: env(url) });
    } finally {
      process.chdir(previous);
    }

    expect(await readdir(workDir)).toEqual([]);
  });

  it('re-downloads instead of failing when a cached file was tampered with', async () => {
    const url = await serveArchive(DIGEST);
    await installBinary({ env: env(url) });

    const binary = join(cacheHome, '999', target.key, 'bin', target.executable);
    await appendFile(binary, 'tampered');

    const before = requests;
    const repaired = await installBinary({ env: env(url) });

    expect(repaired.fromCache).toBe(false);
    expect(requests).toBeGreaterThan(before);

    const integrity = readIntegrity(join(cacheHome, '999', target.key));
    expect(await fileChecksum(binary)).toBe(integrity?.files[`bin/${target.executable}`]);
  });

  it('serves WASM_OPT_VERSION=latest from whatever the cache already holds', async () => {
    const url = await serveArchive(DIGEST);
    await installBinary({ env: env(url) });

    const info = resolveBinarySync({
      env: { WASM_OPT_VERSION: 'latest', WASM_OPT_CACHE_DIR: cacheHome },
    });

    expect(info.source).toBe('cache');
    expect(info.version).toBe('999');
  });

  it('explains what to do when latest was asked for and nothing is cached', async () => {
    expect(() =>
      resolveBinarySync({
        env: { WASM_OPT_VERSION: 'latest', WASM_OPT_CACHE_DIR: join(cacheHome, 'empty'), PATH: '' },
      }),
    ).toThrow(VersionUnavailableError);
  });

  it('installs the portable build the way a platform without a native target would', async () => {
    const staging = await mkdtemp(join(tmpdir(), 'wasm-opt-portable-'));
    const tarball = join(staging, 'binaryen.tar.gz');
    await writeFile(tarball, TARBALL);

    const unpacked = await extractTarball(tarball, WASM_TARGET, join(staging, 'unpacked'));
    const destination = join(cacheHome, '999', WASM_TARGET.key);
    const binary = await installExtracted(unpacked, WASM_TARGET, destination, {
      version: '999',
      asset: WASM_TARGET.asset,
      tarballSha256: DIGEST,
    });

    expect(binary).toBe(join(destination, 'bin', 'wasm-opt.js'));
    expect((await readdir(join(destination, 'bin'))).sort()).toEqual([
      'wasm-opt.js',
      'wasm-opt.wasm',
    ]);

    const integrity = readIntegrity(destination);
    expect(Object.keys(integrity?.files ?? {}).sort()).toEqual([
      'bin/wasm-opt.js',
      'bin/wasm-opt.wasm',
    ]);

    await rm(staging, { recursive: true, force: true });
  });

  it('invalidates the cache entry before overwriting the files it describes', async () => {
    const url = await serveArchive(DIGEST);
    await installBinary({ env: env(url) });

    const dir = join(cacheHome, '999', target.key);
    expect(readIntegrity(dir)).not.toBeNull();

    await expect(
      installExtracted(join(cacheHome, 'absent'), target, dir, {
        version: '999',
        asset: target.asset,
        tarballSha256: DIGEST,
      }),
    ).rejects.toThrow();

    expect(readIntegrity(dir)).toBeNull();
  });

  it('makes the installed binary discoverable from the cache', async () => {
    const url = await serveArchive(DIGEST);
    await installBinary({ env: env(url) });

    const info = resolveBinarySync({
      env: { WASM_OPT_VERSION: '999', WASM_OPT_CACHE_DIR: cacheHome },
    });

    expect(info.source).toBe('cache');
    expect(info.version).toBe('999');
  });
});
