import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ChecksumMismatchError, DownloadError } from '../errors.ts';
import { assetFileName } from './platform.ts';

const RELEASE_BASE = 'https://github.com/WebAssembly/binaryen/releases/download';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const BODY_PREVIEW_BYTES = 200;

export interface DownloadOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly onProgress?: (received: number, total: number | null) => void;
}

export function assetUrl(
  version: string,
  asset: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.WASM_OPT_BINARY_URL || `${RELEASE_BASE}/version_${version}/${assetFileName(version, asset)}`
  );
}

export function checksumUrl(
  version: string,
  asset: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `${assetUrl(version, asset, env)}.sha256`;
}

export function parseChecksum(contents: string): string {
  const match = /^([0-9a-f]{64})\b/i.exec(contents.trim());

  if (!match?.[1]) {
    throw new ChecksumMismatchError(
      `Checksum file did not contain a SHA-256 digest. Received: ${JSON.stringify(contents.slice(0, BODY_PREVIEW_BYTES))}`,
      { expected: 'a 64-character hex digest', actual: contents.slice(0, 64) },
    );
  }

  return match[1].toLowerCase();
}

export function applyProxyFromEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.HTTPS_PROXY && !env.https_proxy && env.npm_config_https_proxy) {
    env.HTTPS_PROXY = env.npm_config_https_proxy;
  }

  if (!env.HTTP_PROXY && !env.http_proxy && env.npm_config_proxy) {
    env.HTTP_PROXY = env.npm_config_proxy;
  }

  if (!env.NO_PROXY && !env.no_proxy && env.npm_config_noproxy) {
    env.NO_PROXY = env.npm_config_noproxy;
  }
}

export async function enableProxy(
  env: NodeJS.ProcessEnv = process.env,
): Promise<(() => void) | null> {
  applyProxyFromEnvironment(env);

  if (!env.HTTPS_PROXY && !env.https_proxy && !env.HTTP_PROXY && !env.http_proxy) {
    return null;
  }

  if (env !== process.env) {
    for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'] as const) {
      const value = env[key];

      if (value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  const http = await import('node:http');

  if (typeof http.setGlobalProxyFromEnv !== 'function') {
    return null;
  }

  const restore: unknown = http.setGlobalProxyFromEnv();
  return typeof restore === 'function' ? (restore as () => void) : () => {};
}

function timeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.WASM_OPT_TIMEOUT;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function retriable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function request(
  url: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  attempts: number = MAX_ATTEMPTS,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'wasm-opt-npm' },
        redirect: 'follow',
        signal: signal ?? AbortSignal.timeout(timeoutMs(env)),
      });

      if (response.ok) {
        return response;
      }

      const preview = (await response.text()).slice(0, BODY_PREVIEW_BYTES);

      lastError = new DownloadError(
        `Request for ${url} failed with ${response.status} ${response.statusText}.`,
        { url, status: response.status, bodyPreview: preview },
      );

      if (!retriable(response.status)) {
        throw lastError;
      }
    } catch (error) {
      if (
        error instanceof DownloadError &&
        error.status !== undefined &&
        !retriable(error.status)
      ) {
        throw error;
      }

      lastError = error;
    }

    if (attempt < attempts) {
      await wait(2 ** (attempt - 1) * 500 + Math.floor(Math.random() * 250));
    }
  }

  if (lastError instanceof DownloadError) {
    throw lastError;
  }

  throw new DownloadError(`Request for ${url} failed after ${attempts} attempt(s).`, {
    url,
    cause: lastError,
  });
}

export async function fetchChecksum(
  version: string,
  asset: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const override = env.WASM_OPT_SHA256;

  if (override) {
    return parseChecksum(override);
  }

  const url = checksumUrl(version, asset, env);
  const response = await request(url, env);
  return parseChecksum(await response.text());
}

export async function downloadTarball(
  version: string,
  asset: string,
  destination: string,
  options: DownloadOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const url = assetUrl(version, asset, env);
  const stall = timeoutMs(env);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await attemptDownload(url, destination, stall, options);
    } catch (error) {
      lastError = error;

      if (
        error instanceof DownloadError &&
        error.status !== undefined &&
        !retriable(error.status)
      ) {
        throw error;
      }

      if (attempt < MAX_ATTEMPTS) {
        await wait(2 ** (attempt - 1) * 500 + Math.floor(Math.random() * 250));
      }
    }
  }

  if (lastError instanceof DownloadError) {
    throw lastError;
  }

  throw new DownloadError(`Download of ${url} failed after ${MAX_ATTEMPTS} attempts.`, {
    url,
    cause: lastError,
  });
}

async function attemptDownload(
  url: string,
  destination: string,
  stall: number,
  options: DownloadOptions,
): Promise<string> {
  const env = options.env ?? process.env;
  const controller = new AbortController();
  let watchdog: NodeJS.Timeout | undefined;
  let stalled = false;

  const arm = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stall);
  };

  arm();

  try {
    const response = await request(url, env, controller.signal, 1);
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.startsWith('text/html')) {
      const preview = (await response.text()).slice(0, BODY_PREVIEW_BYTES);

      throw new DownloadError(
        `Expected a gzip archive at ${url} but received an HTML document. This is usually a proxy or captive-portal interstitial rather than the release asset.`,
        { url, status: response.status, bodyPreview: preview },
      );
    }

    if (!response.body) {
      throw new DownloadError(`Response for ${url} had no body.`, {
        url,
        status: response.status,
      });
    }

    const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    const total = Number.isFinite(declared) ? declared : null;
    const hash = createHash('sha256');
    let received = 0;

    try {
      await pipeline(
        Readable.fromWeb(response.body),
        async function* track(chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            arm();
            hash.update(chunk);
            received += chunk.byteLength;
            options.onProgress?.(received, total);
            yield chunk;
          }
        },
        createWriteStream(destination),
      );
    } catch (error) {
      throw new DownloadError(
        stalled
          ? `Download of ${url} stalled for ${stall} ms after ${received} bytes. Raise WASM_OPT_TIMEOUT if the connection is simply slow.`
          : `Download of ${url} was interrupted after ${received} bytes.`,
        { url, cause: error },
      );
    }

    if (total !== null && received !== total) {
      throw new DownloadError(
        `Download of ${url} is truncated: expected ${total} bytes, received ${received}.`,
        { url, status: response.status },
      );
    }

    return hash.digest('hex');
  } finally {
    clearTimeout(watchdog);
  }
}

export async function fileChecksum(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export function assertChecksum(expected: string, actual: string, url: string): void {
  if (expected !== actual) {
    throw new ChecksumMismatchError(
      `SHA-256 mismatch for ${url}. The download does not match the checksum published by Binaryen and has been discarded.`,
      { expected, actual },
    );
  }
}
