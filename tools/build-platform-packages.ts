import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertChecksum,
  assetUrl,
  downloadTarball,
  fetchChecksum,
  fileChecksum,
} from '../src/core/download.ts';
import { extractTarball, installExtracted } from '../src/core/extract.ts';
import {
  ALL_TARGETS,
  assetFileName,
  currentTarget,
  type Target,
  WASM_TARGET,
} from '../src/core/platform.ts';
import { BINARYEN_VERSION } from '../src/core/version.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tarballCache = join(repoRoot, '.tarball-cache');

interface RootManifest {
  version: string;
  repository: unknown;
  homepage: string;
  license: string;
  author: string;
  engines: Record<string, string>;
}

async function readRootManifest(): Promise<RootManifest> {
  return JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as RootManifest;
}

function manifestFor(target: Target, root: RootManifest, version: string): unknown {
  const [platform, arch] = target.key.split('-');

  return {
    name: target.packageName,
    version: root.version,
    description:
      target.kind === 'wasm'
        ? 'Portable WebAssembly build of Binaryen wasm-opt, for platforms without a native release binary'
        : `Binaryen wasm-opt binary for ${target.key}`,
    keywords: ['wasm', 'wasm-opt', 'binaryen'],
    homepage: root.homepage,
    repository: root.repository,
    license: root.license,
    author: root.author,
    ...(target.kind === 'wasm' ? {} : { os: [platform], cpu: [arch] }),
    engines: root.engines,
    files: target.kind === 'wasm' ? ['bin'] : ['bin', 'lib'],
    publishConfig: { access: 'public' },
    wasmOpt: { binaryenVersion: version },
  };
}

async function cachedTarball(
  version: string,
  target: Target,
): Promise<{ path: string; sha256: string }> {
  await mkdir(tarballCache, { recursive: true });

  const path = join(tarballCache, assetFileName(version, target.asset));
  const url = assetUrl(version, target.asset);
  const expected = await fetchChecksum(version, target.asset);

  if (existsSync(path)) {
    const actual = await fileChecksum(path);

    if (actual === expected) {
      process.stdout.write(`  cache hit ${target.key}\n`);
      return { path, sha256: actual };
    }

    await rm(path, { force: true });
  }

  process.stdout.write(`  downloading ${target.key} from ${url}\n`);
  const actual = await downloadTarball(version, target.asset, path);
  assertChecksum(expected, actual, url);

  return { path, sha256: actual };
}

async function buildPackage(target: Target, root: RootManifest, version: string): Promise<void> {
  const packageDir = join(repoRoot, 'packages', target.key);
  const manifestPath = join(packageDir, 'package.json');

  await mkdir(packageDir, { recursive: true });

  if (!existsSync(manifestPath)) {
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifestFor(target, root, version), null, 2)}\n`,
      'utf8',
    );
  }

  const { path: tarball, sha256 } = await cachedTarball(version, target);
  const staging = await mkdtemp(join(tmpdir(), 'wasm-opt-pkg-'));

  try {
    const unpacked = await extractTarball(tarball, target, staging);
    const binary = await installExtracted(unpacked, target, packageDir, {
      version,
      asset: target.asset,
      tarballSha256: sha256,
    });

    process.stdout.write(`  built ${target.packageName} -> ${binary}\n`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const onlyCurrent = process.argv.includes('--only-current');
const root = await readRootManifest();
const version = process.env.WASM_OPT_VERSION ?? BINARYEN_VERSION;

const targets = onlyCurrent ? [currentTarget() ?? WASM_TARGET] : [...ALL_TARGETS];

process.stdout.write(`Building platform packages for Binaryen ${version}\n`);

for (const target of targets) {
  await buildPackage(target, root, version);
}

process.stdout.write(`Done: ${targets.length} package(s)\n`);
