# Changelog

## 2.0.0

Full rewrite on TypeScript and ESM. Binaryen updated from 112 to 132.

### Breaking changes

- ESM only. `require('wasm-opt')` no longer works; use `await import('wasm-opt')`.
- Requires Node.js >= 24.14.0.
- Intel macOS is no longer supported. Install `@wasm-opt/wasm` instead.
- The CLI now exits with the child's exit code and re-raises its terminating signal.
- Diagnostics go to stderr; stdout carries only the binary's own output.
- No `lib/` directory is created next to the package.
- The package declares no lifecycle scripts. The binary is delivered through
  `optionalDependencies`, so installs work under npm 12, pnpm 10+ and `--ignore-scripts`
  without an allowlist.

### Added

- Platform packages `@wasm-opt/linux-x64`, `linux-arm64`, `darwin-arm64`, `win32-x64`
  and `win32-arm64`, plus the opt-in portable `@wasm-opt/wasm` build for musl, Rosetta
  and Intel macOS.
- A typed programmatic API: `wasmOpt()`, `optimize()`, `resolveBinary()` and
  `BINARYEN_VERSION`.
- `wasm-opt --wasm-opt-info` and `wasm-opt --wasm-opt-install`.
- Configuration through `WASM_OPT_PATH`, `WASM_OPT_VERSION`, `WASM_OPT_BINARY_URL`,
  `WASM_OPT_SHA256`, `WASM_OPT_CACHE_DIR`, `WASM_OPT_TIMEOUT` and `WASM_OPT_FORCE`.

### Fixed

- The shim forwards the child's exit code instead of always exiting `0`.
- Diagnostics are no longer merged into stdout.
- Archives are unpacked into a temporary directory instead of `process.cwd()`.
- HTTP responses are checked, and an HTML proxy interstitial is reported as such.
- Archives are streamed to disk instead of being buffered in memory.
- Every archive is verified against the `.sha256` asset Binaryen publishes before it is
  unpacked, and the digest of each installed file is recorded and re-checked.
- `libbinaryen.dylib` is installed on macOS, where `wasm-opt` links against `@rpath`.
  Static archives are never written to disk.
- The archive root is read from the tar entries instead of being reconstructed.
- musl detection is gated on Linux, so macOS is no longer misclassified.

### 1.4.0

- Updated to `wasm-opt` version 112

### 1.3.0

- Updated to `wasm-opt` version 105

### 1.2.1

- Vulnerabilities fixed

### 1.2.0

- Updated to `wasm-opt` version 101

### 1.1.0
- Added linux and macOS support

### 1.0.0
- Release
