import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BinaryNotFoundError,
  UnsupportedPlatformError,
  VersionUnavailableError,
} from '../errors.ts';
import { cacheDir, cacheRoot, readIntegrity } from './cache.ts';
import {
  currentTarget,
  describePlatform,
  type Target,
  unsupportedReason,
  WASM_TARGET,
} from './platform.ts';
import { BINARYEN_VERSION, resolveVersion } from './version.ts';

export type BinarySource = 'env' | 'cache' | 'package' | 'path';

export interface BinaryInfo {
  readonly path: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly kind: 'native' | 'wasm';
  readonly source: BinarySource;
  readonly version: string | null;
  readonly packageName: string | null;
}

function toInfo(
  path: string,
  target: Pick<Target, 'kind'>,
  source: BinarySource,
  version: string | null,
  packageName: string | null,
): BinaryInfo {
  return target.kind === 'wasm'
    ? { path, command: process.execPath, args: [path], kind: 'wasm', source, version, packageName }
    : { path, command: path, args: [], kind: 'native', source, version, packageName };
}

function fromEnv(env: NodeJS.ProcessEnv): BinaryInfo | null {
  const explicit = env.WASM_OPT_PATH;

  if (!explicit || !existsSync(explicit)) {
    return null;
  }

  const kind = explicit.endsWith('.js') ? WASM_TARGET : { kind: 'native' as const };
  return toInfo(explicit, kind, 'env', null, null);
}

function cachedVersions(env: NodeJS.ProcessEnv): string[] {
  try {
    return readdirSync(cacheRoot(env))
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => Number(b) - Number(a));
  } catch {
    return [];
  }
}

function fromCache(target: Target, version: string, env: NodeJS.ProcessEnv): BinaryInfo | null {
  const candidates = version === 'latest' ? cachedVersions(env) : [version];

  for (const candidate of candidates) {
    const dir = cacheDir(candidate, target.key, env);
    const binary = join(dir, 'bin', target.executable);

    if (existsSync(binary) && readIntegrity(dir) !== null) {
      return toInfo(binary, target, 'cache', candidate, null);
    }
  }

  return null;
}

function fromPackage(target: Target): BinaryInfo | null {
  let manifest: string;

  try {
    manifest = fileURLToPath(import.meta.resolve(`${target.packageName}/package.json`));
  } catch {
    return null;
  }

  const binary = join(dirname(manifest), 'bin', target.executable);
  return existsSync(binary)
    ? toInfo(binary, target, 'package', BINARYEN_VERSION, target.packageName)
    : null;
}

function ownDirectory(): string | null {
  try {
    return realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  } catch {
    return null;
  }
}

export function findOnPath(env: NodeJS.ProcessEnv): BinaryInfo | null {
  const raw = env.PATH ?? env.Path;

  if (!raw || env.WASM_OPT_CHILD === '1') {
    return null;
  }

  const shimDir = `${sep}node_modules${sep}.bin`;
  const executable = process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
  const own = ownDirectory();

  for (const entry of raw.split(delimiter)) {
    if (!entry || entry.includes(shimDir)) {
      continue;
    }

    const candidate = join(entry, executable);

    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const real = realpathSync(candidate);

      if (own !== null && (real === own || real.startsWith(own + sep))) {
        continue;
      }

      return toInfo(real, { kind: 'native' }, 'path', null, null);
    } catch {}
  }

  return null;
}

export function resolveBinarySync(
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): BinaryInfo {
  const env = options.env ?? process.env;
  const requested = resolveVersion({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env,
  });

  const explicit = fromEnv(env);
  if (explicit) {
    return explicit;
  }

  const native = currentTarget();
  const candidates: Target[] = native ? [native, WASM_TARGET] : [WASM_TARGET];

  for (const target of candidates) {
    const cached = fromCache(target, requested.version, env);
    if (cached) {
      return cached;
    }
  }

  if (requested.version === BINARYEN_VERSION) {
    for (const target of candidates) {
      const installed = fromPackage(target);
      if (installed) {
        return installed;
      }
    }
  }

  if (!requested.explicit) {
    const onPath = findOnPath(env);
    if (onPath) {
      return onPath;
    }
  }

  if (requested.version === 'latest') {
    throw new VersionUnavailableError(
      `The newest Binaryen release was requested via ${requested.source}, but no release has been downloaded yet. Resolving "latest" needs the GitHub API, which the CLI never calls on its own.`,
    );
  }

  if (requested.version !== BINARYEN_VERSION) {
    throw new VersionUnavailableError(
      `Binaryen ${requested.version} was requested via ${requested.source} but is not available locally (this build of wasm-opt ships ${BINARYEN_VERSION}).`,
    );
  }

  if (!native) {
    throw new UnsupportedPlatformError(
      `No wasm-opt binary available for ${describePlatform()}. ${unsupportedReason()}`,
    );
  }

  throw new BinaryNotFoundError(`No native wasm-opt binary found for ${describePlatform()}.`);
}
