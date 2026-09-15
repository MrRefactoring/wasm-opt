import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { styleText } from 'node:util';
import { cacheDir, readIntegrity } from './core/cache.ts';
import {
  applyProxyFromEnvironment,
  assertChecksum,
  assetUrl,
  downloadTarball,
  fetchChecksum,
} from './core/download.ts';
import { extractTarball, installExtracted, verifyInstalled } from './core/extract.ts';
import { currentTarget, describePlatform, type Target, WASM_TARGET } from './core/platform.ts';
import { resolveBinarySync } from './core/resolve.ts';
import { resolveLatestVersion, resolveVersion } from './core/version.ts';

export interface InstallResult {
  readonly path: string;
  readonly version: string;
  readonly target: Target;
  readonly fromCache: boolean;
}

function note(message: string): void {
  process.stderr.write(`${message}\n`);
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function progressReporter(): (received: number, total: number | null) => void {
  if (!process.stderr.isTTY) {
    return () => {};
  }

  let lastReport = 0;

  return (received, total) => {
    const now = Date.now();

    if (now - lastReport < 120) {
      return;
    }

    lastReport = now;
    const suffix = total === null ? '' : ` / ${megabytes(total)} MB`;
    process.stderr.write(`\r  downloading ${megabytes(received)} MB${suffix}   `);
  };
}

export async function installBinary(
  options: { env?: NodeJS.ProcessEnv; force?: boolean } = {},
): Promise<InstallResult> {
  const env = options.env ?? process.env;
  const requested = resolveVersion({ env });
  const version =
    requested.version === 'latest' ? await resolveLatestVersion(env) : requested.version;

  const target = currentTarget() ?? WASM_TARGET;
  const destination = cacheDir(version, target.key, env);
  const existing = readIntegrity(destination);
  const force = options.force ?? env.WASM_OPT_FORCE === '1';

  if (existing && !force) {
    await verifyInstalled(destination, existing);

    return {
      path: join(destination, 'bin', target.executable),
      version,
      target,
      fromCache: true,
    };
  }

  applyProxyFromEnvironment(env);

  const staging = await mkdtemp(join(tmpdir(), 'wasm-opt-'));

  try {
    const tarball = join(staging, 'binaryen.tar.gz');
    const url = assetUrl(version, target.asset, env);

    note(`wasm-opt: downloading Binaryen ${version} for ${describePlatform()}`);
    note(`  ${url}`);

    const actual = await downloadTarball(version, target.asset, tarball, {
      env,
      onProgress: progressReporter(),
    });

    if (process.stderr.isTTY) {
      process.stderr.write('\n');
    }

    const expected = await fetchChecksum(version, target.asset, env);
    assertChecksum(expected, actual, url);

    const unpacked = await extractTarball(tarball, target, join(staging, 'unpacked'));
    const path = await installExtracted(unpacked, target, destination, {
      version,
      asset: target.asset,
      tarballSha256: actual,
    });

    note(`wasm-opt: installed ${path}`);

    return { path, version, target, fromCache: false };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function runInstall(): Promise<void> {
  const result = await installBinary();

  if (result.fromCache) {
    note(`wasm-opt: Binaryen ${result.version} already present at ${result.path}`);
  }
}

export async function printInfo(): Promise<void> {
  const binary = resolveBinarySync();
  const probe = spawnSync(binary.command, [...binary.args, '--version'], { encoding: 'utf8' });
  const reported = probe.stdout?.trim() || probe.stderr?.trim() || 'unknown';

  const origin =
    binary.source === 'package' && binary.packageName
      ? `${binary.source} (${binary.packageName})`
      : binary.source;

  const rows: [string, string][] = [
    ['path', binary.path],
    ['version', reported],
    ['source', origin],
    ['kind', binary.kind === 'wasm' ? 'wasm (portable, roughly 2x slower)' : 'native'],
    ['platform', describePlatform()],
  ];

  const label = (text: string): string => (process.stdout.isTTY ? styleText('dim', text) : text);

  for (const [key, value] of rows) {
    process.stdout.write(`${label(`${key}:`.padEnd(10))}${value}\n`);
  }
}
