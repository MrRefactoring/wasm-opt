import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BinaryNotFoundError, VersionUnavailableError } from '../errors.ts';
import { cacheDir, readIntegrity } from './cache.ts';
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

function fromCache(target: Target, version: string, env: NodeJS.ProcessEnv): BinaryInfo | null {
  const dir = cacheDir(version, target.key, env);
  const binary = join(dir, 'bin', target.executable);

  if (!existsSync(binary) || readIntegrity(dir) === null) {
    return null;
  }

  return toInfo(binary, target, 'cache', version, null);
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

function selfPath(): string | null {
  try {
    return realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
}

export function findOnPath(env: NodeJS.ProcessEnv): BinaryInfo | null {
  const raw = env.PATH ?? env.Path;

  if (!raw) {
    return null;
  }

  const shimDir = `${sep}node_modules${sep}.bin`;
  const executable = process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
  const self = selfPath();

  for (const entry of raw.split(delimiter)) {
    if (!entry || entry.includes(shimDir)) {
      continue;
    }

    const candidate = join(entry, executable);

    if (!existsSync(candidate)) {
      continue;
    }

    try {
      if (self !== null && realpathSync(candidate) === self) {
        continue;
      }
    } catch {
      continue;
    }

    return toInfo(candidate, { kind: 'native' }, 'path', null, null);
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

  if (requested.version !== BINARYEN_VERSION) {
    throw new VersionUnavailableError(
      `Binaryen ${requested.version} was requested via ${requested.source} but is not available locally (this build of wasm-opt ships ${BINARYEN_VERSION}).`,
    );
  }

  throw new BinaryNotFoundError(
    native
      ? `No native wasm-opt binary found for ${describePlatform()}.`
      : `No wasm-opt binary available for ${describePlatform()}. ${unsupportedReason()}`,
  );
}

export async function resolveBinary(
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<BinaryInfo> {
  return resolveBinarySync(options);
}
