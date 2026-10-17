import { describe, expect, it } from 'vitest';
import {
  ALL_TARGETS,
  assetFileName,
  describePlatform,
  detectLibc,
  NATIVE_TARGETS,
  targetFor,
  unsupportedReason,
  WASM_TARGET,
} from '../../src/core/platform.ts';

describe('platform matrix', () => {
  const supported: [NodeJS.Platform, string, string, string][] = [
    ['linux', 'x64', 'x86_64-linux', '@wasm-opt/linux-x64'],
    ['linux', 'arm64', 'aarch64-linux', '@wasm-opt/linux-arm64'],
    ['darwin', 'arm64', 'arm64-macos', '@wasm-opt/darwin-arm64'],
    ['win32', 'x64', 'x86_64-windows', '@wasm-opt/win32-x64'],
    ['win32', 'arm64', 'arm64-windows', '@wasm-opt/win32-arm64'],
  ];

  it.each(supported)('maps %s-%s to %s', (platform, arch, asset, packageName) => {
    const target = targetFor(platform, arch, 'glibc');

    expect(target).not.toBeNull();
    expect(target?.asset).toBe(asset);
    expect(target?.packageName).toBe(packageName);
  });

  it('uses .exe only on windows', () => {
    expect(NATIVE_TARGETS['win32-x64'].executable).toBe('wasm-opt.exe');
    expect(NATIVE_TARGETS['win32-arm64'].executable).toBe('wasm-opt.exe');
    expect(NATIVE_TARGETS['linux-x64'].executable).toBe('wasm-opt');
    expect(NATIVE_TARGETS['darwin-arm64'].executable).toBe('wasm-opt');
  });

  it('covers five native targets plus the portable build', () => {
    expect(Object.keys(NATIVE_TARGETS)).toHaveLength(5);
    expect(ALL_TARGETS).toHaveLength(6);
    expect(WASM_TARGET.asset).toBe('node');
  });

  const unsupported: [NodeJS.Platform, string, string][] = [
    ['darwin', 'x64', 'glibc'],
    ['linux', 'riscv64', 'glibc'],
    ['linux', 'x64', 'musl'],
    ['linux', 'arm64', 'musl'],
    ['freebsd', 'x64', 'unknown'],
    ['win32', 'ia32', 'unknown'],
  ];

  it.each(unsupported)('returns null for %s-%s (%s)', (platform, arch, libc) => {
    expect(targetFor(platform, arch, libc as 'glibc' | 'musl' | 'unknown')).toBeNull();
  });
});

describe('libc detection', () => {
  it('never reports musl outside linux', () => {
    expect(detectLibc('darwin')).toBe('unknown');
    expect(detectLibc('win32')).toBe('unknown');
    expect(detectLibc('freebsd')).toBe('unknown');
  });

  it('reports a concrete libc on linux', () => {
    expect(['glibc', 'musl']).toContain(detectLibc('linux'));
  });
});

describe('diagnostics', () => {
  it('names Rosetta in the Intel macOS message', () => {
    expect(unsupportedReason('darwin', 'x64', 'unknown')).toMatch(/Rosetta/);
  });

  it('names musl for Alpine', () => {
    expect(unsupportedReason('linux', 'x64', 'musl')).toMatch(/musl/);
  });

  it('annotates libc only on linux', () => {
    expect(describePlatform('linux', 'x64', 'musl')).toBe('linux-x64 (musl)');
    expect(describePlatform('darwin', 'arm64', 'unknown')).toBe('darwin-arm64');
  });
});

describe('asset names', () => {
  it('matches the names Binaryen publishes', () => {
    expect(assetFileName('132', 'x86_64-linux')).toBe('binaryen-version_132-x86_64-linux.tar.gz');
    expect(assetFileName('132', 'node')).toBe('binaryen-version_132-node.tar.gz');
  });
});
