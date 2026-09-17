import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CacheIntegrity {
  readonly version: string;
  readonly asset: string;
  readonly tarballSha256: string;
  readonly files: Readonly<Record<string, string>>;
}

export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.WASM_OPT_CACHE_DIR;
  if (explicit) {
    return explicit;
  }

  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    if (localAppData) {
      return join(localAppData, 'wasm-opt', 'Cache');
    }
  }

  const xdg = env.XDG_CACHE_HOME;
  return join(xdg || join(homedir(), '.cache'), 'wasm-opt');
}

export function cacheDir(
  version: string,
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(cacheRoot(env), version, key);
}

export function integrityPath(dir: string): string {
  return join(dir, 'integrity.json');
}

export function readIntegrity(dir: string): CacheIntegrity | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(integrityPath(dir), 'utf8'));

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      'asset' in parsed &&
      'tarballSha256' in parsed &&
      'files' in parsed
    ) {
      return parsed as CacheIntegrity;
    }

    return null;
  } catch {
    return null;
  }
}
