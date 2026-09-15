export type PlatformKey =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-arm64'
  | 'win32-x64'
  | 'win32-arm64';

export interface NativeTarget {
  readonly kind: 'native';
  readonly key: PlatformKey;
  readonly asset: string;
  readonly packageName: string;
  readonly executable: string;
}

export interface WasmTarget {
  readonly kind: 'wasm';
  readonly key: 'wasm';
  readonly asset: 'node';
  readonly packageName: '@wasm-opt/wasm';
  readonly executable: 'wasm-opt.js';
}

export type Target = NativeTarget | WasmTarget;

export type Libc = 'glibc' | 'musl' | 'unknown';

const native = (key: PlatformKey, asset: string, executable: string): NativeTarget => ({
  kind: 'native',
  key,
  asset,
  packageName: `@wasm-opt/${key}`,
  executable,
});

export const NATIVE_TARGETS: Readonly<Record<PlatformKey, NativeTarget>> = {
  'linux-x64': native('linux-x64', 'x86_64-linux', 'wasm-opt'),
  'linux-arm64': native('linux-arm64', 'aarch64-linux', 'wasm-opt'),
  'darwin-arm64': native('darwin-arm64', 'arm64-macos', 'wasm-opt'),
  'win32-x64': native('win32-x64', 'x86_64-windows', 'wasm-opt.exe'),
  'win32-arm64': native('win32-arm64', 'arm64-windows', 'wasm-opt.exe'),
};

export const WASM_TARGET: WasmTarget = {
  kind: 'wasm',
  key: 'wasm',
  asset: 'node',
  packageName: '@wasm-opt/wasm',
  executable: 'wasm-opt.js',
};

export const ALL_TARGETS: readonly Target[] = [...Object.values(NATIVE_TARGETS), WASM_TARGET];

export function detectLibc(platform: NodeJS.Platform = process.platform): Libc {
  if (platform !== 'linux') {
    return 'unknown';
  }

  try {
    const header = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } };
    return header?.header?.glibcVersionRuntime ? 'glibc' : 'musl';
  } catch {
    return 'unknown';
  }
}

export function targetFor(
  platform: NodeJS.Platform,
  arch: string,
  libc: Libc = detectLibc(platform),
): NativeTarget | null {
  if (platform === 'linux' && libc === 'musl') {
    return null;
  }

  const key = `${platform}-${arch}`;

  for (const target of Object.values(NATIVE_TARGETS)) {
    if (target.key === key) {
      return target;
    }
  }

  return null;
}

export function currentTarget(): NativeTarget | null {
  return targetFor(process.platform, process.arch);
}

export function describePlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  libc: Libc = detectLibc(platform),
): string {
  return platform === 'linux' && libc !== 'unknown'
    ? `${platform}-${arch} (${libc})`
    : `${platform}-${arch}`;
}

export function unsupportedReason(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  libc: Libc = detectLibc(platform),
): string {
  if (platform === 'darwin' && arch === 'x64') {
    return 'Intel macOS is not supported since 2.0.0. This also covers an x64 Node.js build running under Rosetta on Apple Silicon.';
  }

  if (platform === 'linux' && libc === 'musl') {
    return 'Binaryen publishes no musl build, so Alpine and other musl distributions have no native binary.';
  }

  return `Binaryen publishes no release binary for ${describePlatform(platform, arch, libc)}.`;
}

export function assetFileName(version: string, asset: string): string {
  return `binaryen-version_${version}-${asset}.tar.gz`;
}
