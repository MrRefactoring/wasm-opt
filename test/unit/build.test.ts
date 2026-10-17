import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { currentTarget, WASM_TARGET } from '../../src/core/platform.ts';

const run = promisify(execFile);
const archive = readFileSync('test/fixtures/binaryen-stub.tar.gz');
const digest = '32b663a2afcc9962d6d33a6e0739b8e8f1fdf818481c16596ed4470d250307c3';

it('updates an existing package to the built Binaryen version without changing its npm version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wasm-opt-build-'));
  const target = currentTarget() ?? WASM_TARGET;
  const packageDir = join(directory, 'packages', target.key);
  const manifestPath = join(packageDir, 'package.json');
  const server = createServer((request, response) => {
    response.end(request.url?.endsWith('.sha256') ? `${digest}\n` : archive);
  });

  try {
    await mkdir(join(directory, 'tools'), { recursive: true });
    await mkdir(join(directory, 'src'), { recursive: true });
    await cp(
      'tools/build-platform-packages.ts',
      join(directory, 'tools/build-platform-packages.ts'),
    );
    await cp('src/core', join(directory, 'src/core'), { recursive: true });
    await cp('src/errors.ts', join(directory, 'src/errors.ts'));
    await cp('package.json', join(directory, 'package.json'));
    await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'junction');
    await mkdir(packageDir, { recursive: true });

    const original = JSON.parse(
      await readFile(join('packages', target.key, 'package.json'), 'utf8'),
    ) as { version: string; wasmOpt: { binaryenVersion: string } };
    await writeFile(manifestPath, JSON.stringify(original));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    await run(
      process.execPath,
      [join(directory, 'tools/build-platform-packages.ts'), '--only-current'],
      {
        cwd: directory,
        env: {
          ...process.env,
          WASM_OPT_VERSION: '999',
          WASM_OPT_BINARY_URL: `http://127.0.0.1:${port}/binaryen.tar.gz`,
        },
      },
    );

    const updated = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof original;
    expect(updated).toEqual({
      ...original,
      wasmOpt: { ...original.wasmOpt, binaryenVersion: '999' },
    });
    expect(readFileSync(join(packageDir, 'bin', target.executable)).byteLength).toBeGreaterThan(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
