import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { DownloadError, VersionUnavailableError } from '../errors.ts';

export const BINARYEN_VERSION = '132';

const RELEASES_API = 'https://api.github.com/repos/WebAssembly/binaryen/releases/latest';

export type VersionSource = 'env' | 'npm-config' | 'package.json' | 'pinned';

export interface ResolvedVersion {
  readonly version: string;
  readonly source: VersionSource;
  readonly explicit: boolean;
}

export function normalizeVersion(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed === 'latest') {
    return trimmed;
  }

  const stripped = trimmed.replace(/^version_/, '').replace(/^v/, '');

  if (!/^\d+$/.test(stripped)) {
    throw new VersionUnavailableError(
      `Invalid Binaryen version ${JSON.stringify(raw)}. Expected a release number such as "132", or "latest".`,
    );
  }

  return stripped;
}

function declaredVersion(manifest: string): string | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (error) {
    throw new VersionUnavailableError(
      `Could not read ${manifest} while resolving the Binaryen version.`,
      { cause: error },
    );
  }

  if (typeof parsed !== 'object' || parsed === null || !('wasmOpt' in parsed)) {
    return null;
  }

  const section = (parsed as { wasmOpt: unknown }).wasmOpt;

  if (typeof section !== 'object' || section === null || !('version' in section)) {
    return null;
  }

  const value = (section as { version: unknown }).version;
  return typeof value === 'string' ? value : String(value);
}

function readPackageJsonVersion(cwd: string): string | null {
  let current = cwd;

  for (;;) {
    const manifest = join(current, 'package.json');

    if (existsSync(manifest)) {
      const declared = declaredVersion(manifest);

      if (declared !== null) {
        return declared;
      }
    }

    const parent = dirname(current);

    if (parent === current || current === parse(current).root) {
      return null;
    }

    current = parent;
  }
}

export function resolveVersion(
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): ResolvedVersion {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const fromEnv = env.WASM_OPT_VERSION;
  if (fromEnv) {
    return { version: normalizeVersion(fromEnv), source: 'env', explicit: true };
  }

  const fromNpm = env.npm_config_wasm_opt_version;
  if (fromNpm) {
    return { version: normalizeVersion(fromNpm), source: 'npm-config', explicit: true };
  }

  const fromPackage = readPackageJsonVersion(cwd);
  if (fromPackage) {
    return { version: normalizeVersion(fromPackage), source: 'package.json', explicit: true };
  }

  return { version: BINARYEN_VERSION, source: 'pinned', explicit: false };
}

export async function resolveLatestVersion(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'wasm-opt-npm',
  };

  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(RELEASES_API, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 403 || response.status === 429) {
    throw new DownloadError(
      'GitHub API rate limit reached while resolving WASM_OPT_VERSION=latest. Unauthenticated clients get 60 requests per hour per IP, which shared CI runners exhaust quickly. Set GITHUB_TOKEN, or pin an explicit version such as WASM_OPT_VERSION=132.',
      { url: RELEASES_API, status: response.status },
    );
  }

  if (!response.ok) {
    throw new DownloadError(
      `GitHub API returned ${response.status} ${response.statusText} while resolving the latest Binaryen release.`,
      { url: RELEASES_API, status: response.status },
    );
  }

  const payload: unknown = await response.json();
  const tag =
    typeof payload === 'object' && payload !== null && 'tag_name' in payload
      ? (payload as { tag_name: unknown }).tag_name
      : undefined;

  if (typeof tag !== 'string') {
    throw new DownloadError('GitHub API response did not contain a tag_name.', {
      url: RELEASES_API,
    });
  }

  return normalizeVersion(tag);
}
