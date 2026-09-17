import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts', 'src/install.ts'],
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node24',
  fixedExtension: false,
  dts: true,
  clean: true,
  treeshake: true,
  deps: {
    neverBundle: ['tar'],
  },
});
