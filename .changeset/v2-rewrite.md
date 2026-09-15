---
'@wasm-opt/darwin-arm64': major
'@wasm-opt/linux-arm64': major
'@wasm-opt/linux-x64': major
'@wasm-opt/win32-arm64': major
'@wasm-opt/win32-x64': major
'@wasm-opt/wasm': major
'wasm-opt': major
---

Rewrite the package on TypeScript and ESM, and deliver the Binaryen binary through
`optionalDependencies` instead of a `postinstall` download.

Breaking changes:

- ESM only; `require('wasm-opt')` no longer works.
- Requires Node.js >= 24.14.0.
- The CLI now propagates the child's exit code and terminating signal.
- Diagnostics go to stderr instead of stdout.
- No `lib/` directory is created next to the package.
- Intel macOS is no longer supported; use `@wasm-opt/wasm`.
- The package declares no lifecycle scripts at all.

Binaryen is updated from 112 to 132. Downloads are SHA-256 verified against the checksum Binaryen
publishes, streamed rather than buffered, and unpacked into a temporary directory instead of the
current working directory.
