import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BINARYEN_VERSION } from '../../src/core/version.ts';

const CLI = resolve('dist/cli.js');
const FIXTURE = resolve('test/fixtures/input.wasm');
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

let workDir = '';

function run(args: string[], options: { input?: Buffer } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    ...(options.input === undefined ? {} : { input: options.input }),
    encoding: 'buffer',
  });
}

beforeAll(async () => {
  if (!existsSync(CLI)) {
    throw new Error('dist/cli.js is missing. Run "pnpm build" before the e2e project.');
  }

  workDir = await mkdtemp(join(tmpdir(), 'wasm-opt-e2e-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('cli contract', () => {
  it('reports the Binaryen version this build ships', () => {
    const result = run(['--version']);

    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toContain(`version ${BINARYEN_VERSION}`);
    expect(result.stderr.toString()).toBe('');
  });

  it('optimises a module and produces a strictly smaller one', async () => {
    const output = join(workDir, 'optimised.wasm');
    const result = run([FIXTURE, '-O3', '-o', output]);

    expect(result.status).toBe(0);

    const before = readFileSync(FIXTURE);
    const after = readFileSync(output);

    expect(after.subarray(0, 8)).toEqual(WASM_MAGIC);
    expect(after.byteLength).toBeLessThan(before.byteLength);
  });

  it('propagates a failure exit code and keeps stdout clean', () => {
    const result = run([join(workDir, 'absent.wasm'), '-o', join(workDir, 'out.wasm')]);

    expect(result.status).toBe(1);
    expect(result.stdout.byteLength).toBe(0);
    expect(result.stderr.toString()).toMatch(/Failed opening/);
  });

  it('writes a binary module to stdout without touching stderr', () => {
    const result = run([FIXTURE, '-O3', '-o', '-']);

    expect(result.status).toBe(0);
    expect(result.stdout.subarray(0, 8)).toEqual(WASM_MAGIC);
    expect(result.stderr.byteLength).toBe(0);
  });

  it('proxies a module through stdin and stdout', () => {
    const result = run(['-', '-O3', '-o', '-'], { input: readFileSync(FIXTURE) });

    expect(result.status).toBe(0);
    expect(result.stdout.subarray(0, 8)).toEqual(WASM_MAGIC);
  });

  it('answers --wasm-opt-info on stdout', () => {
    const result = run(['--wasm-opt-info']);

    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toMatch(/^path: /m);
    expect(result.stdout.toString()).toMatch(/^source: /m);
  });

  it('forwards --wasm-opt-info to Binaryen when it is not the only argument', () => {
    const result = run(['--wasm-opt-info', FIXTURE]);

    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toMatch(/Unknown option/);
  });

  it('explains itself when no binary can be resolved', async () => {
    const isolated = await mkdtemp(join(tmpdir(), 'wasm-opt-isolated-'));
    await writeFile(join(isolated, 'package.json'), JSON.stringify({ name: 'consumer' }));

    const result = spawnSync(process.execPath, [CLI, '--version'], {
      encoding: 'utf8',
      cwd: isolated,
      env: {
        ...process.env,
        PATH: '',
        Path: '',
        WASM_OPT_VERSION: '111',
        WASM_OPT_CACHE_DIR: join(isolated, 'cache'),
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/Binaryen 111 was requested/);
    expect(result.stderr).toMatch(/--wasm-opt-install/);

    await rm(isolated, { recursive: true, force: true });
  });
});

describe('signal propagation', () => {
  it.skipIf(process.platform === 'win32')('dies by the signal that killed the child', async () => {
    const script = join(workDir, 'suicide.sh');
    await writeFile(script, '#!/bin/sh\nkill -TERM $$\n', { mode: 0o755 });

    const result = spawnSync(process.execPath, [CLI, 'anything'], {
      encoding: 'buffer',
      env: { ...process.env, WASM_OPT_PATH: script },
    });

    expect(result.signal).toBe('SIGTERM');
    expect(result.status).toBeNull();
  });
});
