# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| 1.x | No |

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/MrRefactoring/wasm-opt/security/advisories/new).
Please do not open a public issue for an unfixed vulnerability.

Include the affected version, the platform, and the smallest reproduction you have. Expect a first
response within seven days.

If the problem is in the `wasm-opt` optimiser itself rather than in this wrapper, report it to
[Binaryen](https://github.com/WebAssembly/binaryen/security) instead.

## What this package guarantees

- **No install scripts.** The published package declares no `preinstall`, `install`, `postinstall`
  or `prepare` hook, so `npm install` executes none of our code.
- **Pinned download origin.** Archives are fetched only from
  `https://github.com/WebAssembly/binaryen/releases/download/...` unless an operator sets
  `WASM_OPT_BINARY_URL` deliberately.
- **Mandatory integrity checks.** Every archive is verified against the SHA-256 digest Binaryen
  publishes alongside it before it is unpacked, and the digest of every installed file is recorded
  and re-checked. There is no flag that disables this.
- **Provenance.** All packages are published from GitHub Actions with npm provenance attestations,
  so the published artefact can be traced back to the commit and workflow that built it.
- **One runtime dependency.** `tar`, and only on the explicit `--wasm-opt-install` path. The CLI
  shim imports nothing outside `node:*`.
