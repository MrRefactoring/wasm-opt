import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cacheRoot } from '../../src/core/cache.ts';
import { findOnPath, packagedVersion, resolveBinarySync } from '../../src/core/resolve.ts';
import { InvalidOverrideError, VersionUnavailableError } from '../../src/errors.ts';

function emptyProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wasm-opt-resolve-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer' }));
  return dir;
}

describe('resolution order', () => {
  it('lets WASM_OPT_PATH win over everything else', () => {
    const dir = emptyProject();
    const fake = join(dir, 'my-wasm-opt');
    writeFileSync(fake, '');

    const info = resolveBinarySync({ cwd: dir, env: { WASM_OPT_PATH: fake } });

    expect(info.source).toBe('env');
    expect(info.path).toBe(fake);
    expect(info.command).toBe(fake);
  });

  it('runs a .js override through the current Node executable', () => {
    const dir = emptyProject();
    const fake = join(dir, 'wasm-opt.js');
    writeFileSync(fake, '');

    const info = resolveBinarySync({ cwd: dir, env: { WASM_OPT_PATH: fake } });

    expect(info.kind).toBe('wasm');
    expect(info.command).toBe(process.execPath);
    expect(info.args).toEqual([fake]);
  });

  it('refuses to fall through when WASM_OPT_PATH points at nothing', () => {
    const dir = emptyProject();
    const absent = join(dir, 'absent');

    expect(() =>
      resolveBinarySync({
        cwd: dir,
        env: { WASM_OPT_PATH: absent },
      }),
    ).toThrow(InvalidOverrideError);

    try {
      resolveBinarySync({ cwd: dir, env: { WASM_OPT_PATH: absent } });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain(absent);
    }
  });

  it('refuses to substitute a different version for the one requested', () => {
    const dir = emptyProject();

    expect(() =>
      resolveBinarySync({
        cwd: dir,
        env: { WASM_OPT_VERSION: '111', WASM_OPT_CACHE_DIR: join(dir, 'cache'), PATH: '' },
      }),
    ).toThrow(VersionUnavailableError);
  });

  it('reports the requested and the shipped version in the message', () => {
    const dir = emptyProject();

    try {
      resolveBinarySync({
        cwd: dir,
        env: { WASM_OPT_VERSION: '111', WASM_OPT_CACHE_DIR: join(dir, 'cache'), PATH: '' },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/111/);
      expect((error as Error).message).toMatch(/132/);
    }
  });

  it('never picks a shim out of node_modules/.bin', () => {
    const dir = emptyProject();
    const shimDir = join(dir, 'node_modules', '.bin');
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(join(shimDir, 'wasm-opt'), '');
    writeFileSync(join(shimDir, 'wasm-opt.exe'), '');

    expect(findOnPath({ PATH: shimDir })).toBeNull();
  });

  it('accepts a genuine system binary on PATH', () => {
    const dir = emptyProject();
    const binDir = join(dir, 'usr-local-bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt'), '');

    const found = findOnPath({ PATH: binDir });

    expect(found?.source).toBe('path');
    expect(found?.version).toBeNull();
  });

  it('returns nothing when PATH is empty', () => {
    expect(findOnPath({ PATH: '' })).toBeNull();
    expect(findOnPath({})).toBeNull();
  });
});

describe('platform package version', () => {
  it('reads the Binaryen version the package carries', () => {
    const dir = emptyProject();
    const manifest = join(dir, 'package.json');

    writeFileSync(manifest, JSON.stringify({ wasmOpt: { binaryenVersion: '121' } }));
    expect(packagedVersion(manifest)).toBe('121');
  });

  it('falls back when the field is absent or malformed', () => {
    const dir = emptyProject();
    const manifest = join(dir, 'manifest.json');

    expect(packagedVersion(join(dir, 'package.json'))).toBeNull();
    expect(packagedVersion(join(dir, 'absent.json'))).toBeNull();

    writeFileSync(manifest, JSON.stringify({ wasmOpt: { binaryenVersion: 132 } }));
    expect(packagedVersion(manifest)).toBeNull();

    writeFileSync(manifest, '{ not json');
    expect(packagedVersion(manifest)).toBeNull();
  });

  it('reports the version recorded in the resolved platform package', () => {
    const dir = emptyProject();
    const info = resolveBinarySync({
      cwd: dir,
      env: { WASM_OPT_CACHE_DIR: join(dir, 'cache'), PATH: '' },
    });

    if (info.source !== 'package' || info.packageName === null) {
      return;
    }

    const manifest = fileURLToPath(import.meta.resolve(`${info.packageName}/package.json`));
    expect(info.version).toBe(packagedVersion(manifest));
  });
});

describe('self-invocation guard', () => {
  it('refuses PATH lookup inside a child this package spawned', () => {
    const dir = emptyProject();
    const binDir = join(dir, 'usr-local-bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt'), '');

    expect(findOnPath({ PATH: binDir })).not.toBeNull();
    expect(findOnPath({ PATH: binDir, WASM_OPT_CHILD: '1' })).toBeNull();
  });

  it('never returns a binary that lives inside this package', () => {
    const own = dirname(fileURLToPath(import.meta.url));
    const distLike = join(own, '..', '..', 'dist');

    if (!existsSync(distLike)) {
      return;
    }

    const found = findOnPath({ PATH: distLike });
    expect(found).toBeNull();
  });
});

describe('cache location', () => {
  it('honours WASM_OPT_CACHE_DIR', () => {
    expect(cacheRoot({ WASM_OPT_CACHE_DIR: '/custom' })).toBe('/custom');
  });

  it('follows XDG_CACHE_HOME elsewhere', () => {
    expect(cacheRoot({ XDG_CACHE_HOME: '/xdg' })).toBe(join('/xdg', 'wasm-opt'));
  });
});
