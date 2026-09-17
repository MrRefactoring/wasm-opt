import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BINARYEN_VERSION, optimize, resolveBinary, wasmOpt } from '../../src/index.ts';

const FIXTURE = resolve('test/fixtures/input.wasm');
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

describe('programmatic api', () => {
  it('resolves the binary it will run', async () => {
    const info = await resolveBinary();

    expect(info.path).toBeTruthy();
    expect(['native', 'wasm']).toContain(info.kind);
    expect(['env', 'cache', 'package', 'path']).toContain(info.source);
  });

  it('captures stdout and stderr separately', async () => {
    const result = await wasmOpt(['--version']);

    expect(result.status).toBe(0);
    expect(Buffer.from(result.stdout).toString()).toContain(`version ${BINARYEN_VERSION}`);
    expect(result.stderr).toBe('');
  });

  it('surfaces a non-zero status without throwing', async () => {
    const result = await wasmOpt(['/nonexistent.wasm', '-o', '/dev/null']);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Failed opening/);
    expect(result.stdout.byteLength).toBe(0);
  });

  it('optimises a module in memory without touching the disk', async () => {
    const input = readFileSync(FIXTURE);
    const output = await optimize(input, ['-O3']);

    expect(Buffer.from(output.subarray(0, 8))).toEqual(WASM_MAGIC);
    expect(output.byteLength).toBeLessThan(input.byteLength);
  });

  it('throws with the binary diagnostics when optimisation fails', async () => {
    await expect(optimize(Buffer.from('not a wasm module'))).rejects.toThrow(/wasm-opt exited/);
  });
});

describe('api robustness', () => {
  it('does not crash the host process when the child ignores stdin', async () => {
    const result = await wasmOpt(['--version'], { stdin: Buffer.alloc(64 * 1024 * 1024) });

    expect(result.status).toBe(0);
    expect(Buffer.from(result.stdout).toString()).toContain('version');
  });

  it('rejects rather than throwing when the call is aborted', async () => {
    await expect(wasmOpt(['--version'], { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('keeps the child environment usable when env is supplied', async () => {
    const result = await wasmOpt(['--version'], { env: { WASM_OPT_MARKER: '1' } });

    expect(result.status).toBe(0);
    expect(Buffer.from(result.stdout).toString()).toContain(`version ${BINARYEN_VERSION}`);
  });

  it('keeps the ambient configuration visible when env is supplied', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wasm-opt-api-'));
    const override = join(dir, 'my-wasm-opt');
    writeFileSync(override, '');
    const previous = process.env.WASM_OPT_PATH;
    process.env.WASM_OPT_PATH = override;

    try {
      const plain = await resolveBinary();
      const extended = await resolveBinary({ env: { WASM_OPT_MARKER: '1' } });

      expect(plain.source).toBe('env');
      expect(extended.source).toBe('env');
      expect(extended.path).toBe(override);
    } finally {
      if (previous === undefined) {
        delete process.env.WASM_OPT_PATH;
      } else {
        process.env.WASM_OPT_PATH = previous;
      }

      rmSync(dir, { recursive: true, force: true });
    }
  });
});
