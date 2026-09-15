import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentTarget, WASM_TARGET } from '../../src/core/platform.ts';
import { BINARYEN_VERSION } from '../../src/core/version.ts';

const target = currentTarget() ?? WASM_TARGET;

let registry = '';
let rootTarball = '';
let leafTarball = '';

function npm(args: string[], cwd: string) {
  return spawnSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
}

function pack(packageDir: string): string {
  const before = new Set(readdirSync(registry));
  const result = npm(['pack', '--pack-destination', registry, resolve(packageDir)], registry);

  if (result.status !== 0) {
    throw new Error(`npm pack failed for ${packageDir}: ${result.stderr}`);
  }

  const created = readdirSync(registry).find((name) => !before.has(name));

  if (!created) {
    throw new Error(`npm pack produced no tarball for ${packageDir}`);
  }

  return join(registry, created);
}

async function consumer(
  flags: string[],
): Promise<{ dir: string; install: ReturnType<typeof npm> }> {
  const dir = await mkdtemp(join(tmpdir(), 'wasm-opt-consumer-'));

  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'consumer',
        version: '1.0.0',
        private: true,
        overrides: { [target.packageName]: `file:${leafTarball}` },
      },
      null,
      2,
    ),
  );

  const install = npm(['install', rootTarball, '--no-audit', '--no-fund', ...flags], dir);
  return { dir, install };
}

function runCli(dir: string) {
  return spawnSync(
    process.execPath,
    [join(dir, 'node_modules/wasm-opt/dist/cli.js'), '--version'],
    {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: '', Path: '' },
    },
  );
}

beforeAll(async () => {
  registry = await mkdtemp(join(tmpdir(), 'wasm-opt-registry-'));
  rootTarball = pack('.');
  leafTarball = pack(join('packages', target.key));
}, 300_000);

afterAll(async () => {
  await rm(registry, { recursive: true, force: true });
});

describe('delivery through optionalDependencies', () => {
  it('works on a default install', async () => {
    const { dir, install } = await consumer([]);

    expect(install.status).toBe(0);
    const result = runCli(dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`version ${BINARYEN_VERSION}`);

    await rm(dir, { recursive: true, force: true });
  }, 300_000);

  it('works identically with --ignore-scripts, because there are none', async () => {
    const { dir, install } = await consumer(['--ignore-scripts']);

    expect(install.status).toBe(0);
    const result = runCli(dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`version ${BINARYEN_VERSION}`);

    await rm(dir, { recursive: true, force: true });
  }, 300_000);

  it('ships no lifecycle scripts at all', async () => {
    const { dir } = await consumer(['--ignore-scripts']);
    const manifest = JSON.parse(
      spawnSync('node', ['-p', 'JSON.stringify(require("wasm-opt/package.json"))'], {
        cwd: dir,
        encoding: 'utf8',
      }).stdout,
    ) as { scripts?: Record<string, string> };

    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
      expect(manifest.scripts?.[hook]).toBeUndefined();
    }

    await rm(dir, { recursive: true, force: true });
  }, 300_000);

  it('fails loudly with actionable advice under --no-optional', async () => {
    const { dir, install } = await consumer(['--no-optional', '--ignore-scripts']);

    expect(install.status).toBe(0);
    const result = runCli(dir);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/native wasm-opt binary|no wasm-opt binary/i);
    expect(result.stderr).toMatch(/--wasm-opt-install/);
    expect(result.stderr).toMatch(/@wasm-opt\/wasm/);

    await rm(dir, { recursive: true, force: true });
  }, 300_000);
});
