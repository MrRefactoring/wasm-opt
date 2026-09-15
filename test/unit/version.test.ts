import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BINARYEN_VERSION, normalizeVersion, resolveVersion } from '../../src/core/version.ts';
import { VersionUnavailableError } from '../../src/errors.ts';

function projectWith(wasmOpt: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'wasm-opt-version-'));
  const manifest = wasmOpt === undefined ? { name: 'consumer' } : { name: 'consumer', wasmOpt };
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  return dir;
}

describe('version precedence', () => {
  it('prefers WASM_OPT_VERSION over everything', () => {
    const cwd = projectWith({ version: '120' });
    const resolved = resolveVersion({
      cwd,
      env: { WASM_OPT_VERSION: '128', npm_config_wasm_opt_version: '124' },
    });

    expect(resolved).toEqual({ version: '128', source: 'env', explicit: true });
  });

  it('falls back to npm_config_wasm_opt_version', () => {
    const cwd = projectWith({ version: '120' });
    const resolved = resolveVersion({ cwd, env: { npm_config_wasm_opt_version: '124' } });

    expect(resolved).toEqual({ version: '124', source: 'npm-config', explicit: true });
  });

  it('then reads wasmOpt.version from the nearest package.json', () => {
    const cwd = projectWith({ version: '120' });
    const resolved = resolveVersion({ cwd, env: {} });

    expect(resolved).toEqual({ version: '120', source: 'package.json', explicit: true });
  });

  it('finally falls back to the compiled-in pin', () => {
    const cwd = projectWith(undefined);
    const resolved = resolveVersion({ cwd, env: {} });

    expect(resolved).toEqual({ version: BINARYEN_VERSION, source: 'pinned', explicit: false });
  });

  it('stops at the nearest package.json instead of walking past it', () => {
    const cwd = projectWith(undefined);
    expect(resolveVersion({ cwd, env: {} }).source).toBe('pinned');
  });
});

describe('version normalisation', () => {
  it.each([
    ['132', '132'],
    ['v132', '132'],
    ['version_132', '132'],
    ['  132  ', '132'],
    ['latest', 'latest'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeVersion(input)).toBe(expected);
  });

  it.each(['1.2.3', 'main', '', 'version_abc'])('rejects %s', (input) => {
    expect(() => normalizeVersion(input)).toThrow(VersionUnavailableError);
  });
});
