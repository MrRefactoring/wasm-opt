import { chmod, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extract } from 'tar';
import { ChecksumMismatchError, ExtractionError } from '../errors.ts';
import type { CacheIntegrity } from './cache.ts';
import { integrityPath } from './cache.ts';
import { fileChecksum } from './download.ts';
import type { Target } from './platform.ts';

const SHARED_LIBRARY = /^lib\/[^/]+\.(?:dylib|so)(?:\.\d+)*$/;

function relativeEntry(entryPath: string): string | null {
  const normalized = entryPath.replaceAll('\\', '/');
  const separator = normalized.indexOf('/');
  return separator === -1 ? null : normalized.slice(separator + 1);
}

function isWanted(target: Target, relative: string): boolean {
  if (target.kind === 'wasm') {
    return relative === 'wasm-opt.js' || relative === 'wasm-opt.wasm';
  }

  return relative === `bin/${target.executable}` || SHARED_LIBRARY.test(relative);
}

async function unpackedRoot(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const root = directories[0];

  if (directories.length !== 1 || !root) {
    throw new ExtractionError(
      `Expected the Binaryen archive to contain exactly one top-level directory, found ${directories.length}.`,
    );
  }

  return join(directory, root.name);
}

export async function extractTarball(
  tarball: string,
  target: Target,
  into: string,
): Promise<string> {
  await mkdir(into, { recursive: true });

  await extract({
    file: tarball,
    cwd: into,
    filter: (entryPath) => {
      const relative = relativeEntry(entryPath);
      return relative !== null && isWanted(target, relative);
    },
  });

  return unpackedRoot(into);
}

export async function installExtracted(
  source: string,
  target: Target,
  destination: string,
  integrity: Omit<CacheIntegrity, 'files'>,
): Promise<string> {
  await rm(integrityPath(destination), { force: true });
  await rm(join(destination, 'bin'), { recursive: true, force: true });
  await rm(join(destination, 'lib'), { recursive: true, force: true });
  await mkdir(join(destination, 'bin'), { recursive: true });
  await mkdir(join(destination, 'lib'), { recursive: true });

  const executable = join(destination, 'bin', target.executable);
  const copied: string[] = [];

  if (target.kind === 'wasm') {
    for (const name of ['wasm-opt.js', 'wasm-opt.wasm']) {
      await copyFile(join(source, name), join(destination, 'bin', name));
      copied.push(`bin/${name}`);
    }

    await chmod(executable, 0o755);
  } else {
    await copyFile(join(source, 'bin', target.executable), executable);
    await chmod(executable, 0o755);
    copied.push(`bin/${target.executable}`);

    const libraries = await readdir(join(source, 'lib')).catch(() => [] as string[]);

    for (const name of libraries) {
      const library = join(destination, 'lib', name);
      await copyFile(join(source, 'lib', name), library);
      await chmod(library, 0o755);
      copied.push(`lib/${name}`);
    }
  }

  const files: Record<string, string> = {};

  for (const relative of copied) {
    files[relative] = await fileChecksum(join(destination, relative));
  }

  await writeFile(
    integrityPath(destination),
    `${JSON.stringify({ ...integrity, files }, null, 2)}\n`,
    'utf8',
  );

  return executable;
}

export async function verifyInstalled(
  destination: string,
  integrity: CacheIntegrity,
): Promise<void> {
  for (const [relative, expected] of Object.entries(integrity.files)) {
    const actual = await fileChecksum(join(destination, relative));

    if (actual !== expected) {
      throw new ChecksumMismatchError(
        `Cached file ${relative} in ${destination} does not match the digest recorded at install time.`,
        { expected, actual },
      );
    }
  }
}
