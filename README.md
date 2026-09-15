# wasm-opt

The native `wasm-opt` optimiser from [Binaryen](https://github.com/WebAssembly/binaryen), delivered
as an npm package with a CLI and a typed programmatic API.

- **No install scripts.** The binary arrives through `optionalDependencies`, so installation works
  unchanged under npm 12, pnpm 10+, `--ignore-scripts`, and any sandbox that blocks lifecycle hooks.
- **Every byte verified.** Anything downloaded is checked against the SHA-256 digest Binaryen
  publishes next to the release asset. There is no way to turn that off.
- **A transparent shim.** Arguments, both streams, the exit code and the terminating signal are
  passed through unchanged.

Currently ships **Binaryen 132**.

## Install

```sh
npm install --save-dev wasm-opt
```

```sh
npm install --global wasm-opt
```

## Usage

Every argument goes straight to the native binary:

```sh
wasm-opt input.wasm -O3 -o output.wasm
wasm-opt input.wasm -Oz --enable-simd -o output.wasm
cat input.wasm | wasm-opt - -O3 -o - > output.wasm
```

Two commands belong to this package rather than to Binaryen. They are recognised only when passed
as the **single** argument, so they can never shadow a Binaryen flag or a file name:

```sh
wasm-opt --wasm-opt-info      # resolved path, version and where it came from
wasm-opt --wasm-opt-install   # download the binary into the shared cache
```

### Programmatic API

```js
import { optimize, wasmOpt, resolveBinary, BINARYEN_VERSION } from 'wasm-opt';

const optimised = await optimize(await readFile('input.wasm'), ['-O3']);

const { status, stdout, stderr } = await wasmOpt(['input.wasm', '-O3', '-o', 'out.wasm']);

const { path, kind, source } = await resolveBinary();
```

`optimize()` pipes the module through the binary's stdin and stdout, so bundler plugins never need a
temporary file. `wasmOpt()` is the escape hatch: it takes the raw argument list and returns the
captured streams without throwing on a non-zero exit.

The package is **ESM only**. From CommonJS, use `await import('wasm-opt')`.

## Supported platforms

| Platform | Binaryen asset | Package |
| --- | --- | --- |
| `linux-x64` | `x86_64-linux` | `@wasm-opt/linux-x64` |
| `linux-arm64` | `aarch64-linux` | `@wasm-opt/linux-arm64` |
| `darwin-arm64` | `arm64-macos` | `@wasm-opt/darwin-arm64` |
| `win32-x64` | `x86_64-windows` | `@wasm-opt/win32-x64` |
| `win32-arm64` | `arm64-windows` | `@wasm-opt/win32-arm64` |
| anything else | `node` | `@wasm-opt/wasm` (opt-in) |

Requires Node.js **24.14.0** or newer.

Intel macOS is not supported from 2.0.0 onwards. Neither is musl (Alpine): Binaryen publishes no
musl build. On those platforms, and anywhere else without a native asset, install the portable
WebAssembly build, which runs wherever Node.js runs at roughly half the speed:

```sh
npm install --save-dev @wasm-opt/wasm
```

It is not an `optionalDependency`, so it costs nothing to everyone who does not need it. Once
installed it is picked up automatically, and `--wasm-opt-info` will say so.

### Choosing between this package and `binaryen`

The [`binaryen`](https://www.npmjs.com/package/binaryen) package ships the same optimiser compiled to
WebAssembly, plus a full JavaScript API for building modules. Prefer it when you need that API or
when portability matters more than speed. Prefer this package when you want the native optimiser,
which is roughly twice as fast ([WebAssembly/binaryen#6338](https://github.com/WebAssembly/binaryen/issues/6338)).

## How the binary is found

Resolution stops at the first hit:

1. `WASM_OPT_PATH` — an explicit override, used exactly as given and never version-checked.
2. The shared cache, for the version that was requested.
3. The platform package from `optionalDependencies`, only if it carries the requested version.
4. A `wasm-opt` on `PATH`, only when no version was requested explicitly. Shims inside
   `node_modules/.bin` are skipped, so the package can never invoke itself.

If a version was requested that none of these can supply, the CLI exits `1` and says which version
was asked for and which one is installed. It never silently substitutes a different build, and it
never downloads anything on its own.

## Environment variables

Each one also has an `npm_config_*` counterpart, so `npm config set wasm_opt_version 130` works too.

| Variable | Effect |
| --- | --- |
| `WASM_OPT_PATH` | Use this binary and skip resolution entirely. |
| `WASM_OPT_VERSION` | Binaryen release to use — `132`, `version_132` or `latest`. |
| `WASM_OPT_BINARY_URL` | Download the archive from here instead of GitHub. |
| `WASM_OPT_SHA256` | Expected digest, for mirrors that do not serve the `.sha256` sibling. |
| `WASM_OPT_CACHE_DIR` | Cache location. |
| `WASM_OPT_TIMEOUT` | Per-request timeout in milliseconds. Default `120000`. |
| `WASM_OPT_FORCE` | Set to `1` to re-download even on a cache hit. |
| `GITHUB_TOKEN` | Raises the API rate limit for `WASM_OPT_VERSION=latest`. |

The version can also be pinned from the consuming project:

```json
{
  "wasmOpt": { "version": "130" }
}
```

`WASM_OPT_VERSION=latest` is opt-in on purpose. Resolving it hits the GitHub API, which allows
60 unauthenticated requests per hour per IP — a limit that any shared-NAT CI exhausts immediately —
and it makes builds non-reproducible.

## How integrity is verified

1. The archive is streamed to a temporary file while its SHA-256 is computed. It is never held in
   memory, and it is never unpacked before it has been verified.
2. `<asset>.tar.gz.sha256` is fetched from the same location and compared. A mismatch throws
   `ChecksumMismatchError` and the download is discarded.
3. Only then is the archive unpacked, and only `bin/wasm-opt[.exe]` plus any shared library is taken
   from it. Static archives (`libbinaryen.a`, `binaryen.lib`, together ~490 MB on Windows) are never
   written to disk.
4. The digest of every installed file is recorded in `integrity.json` and re-checked on the next
   `--wasm-opt-install`.

The binaries themselves are published by Binaryen's own release workflow and are only fetched from
`https://github.com/WebAssembly/binaryen/releases/download/...` unless `WASM_OPT_BINARY_URL` says
otherwise. The npm packages are published from CI with npm provenance.

## Cache layout

```
${XDG_CACHE_HOME:-~/.cache}/wasm-opt/<version>/<platform>-<arch>/
%LOCALAPPDATA%\wasm-opt\Cache\<version>\<platform>-<arch>\
```

Each directory holds `bin/`, `lib/` and `integrity.json`. A cache hit performs no network access at
all.

## Troubleshooting

### The binary is missing after install

This package runs no install scripts, so `approve-scripts` and `approve-builds` are never needed. A
missing binary means the platform package was not installed. The usual causes:

- the install ran with `--no-optional` ([esbuild#2558](https://github.com/evanw/esbuild/issues/2558));
- the lockfile omits the platform package ([npm/cli#8320](https://github.com/npm/cli/issues/8320));
- optional dependencies were pruned ([npm/cli#7961](https://github.com/npm/cli/issues/7961));
- `node_modules` was copied between architectures, for example from a macOS host into a Linux
  container image. Install inside the image instead of copying into it.

Re-running `npm install` fixes most of these. Otherwise:

```sh
npx wasm-opt --wasm-opt-install
npm install --save-dev @wasm-opt/wasm
export WASM_OPT_PATH=/usr/local/bin/wasm-opt
```

### Behind a corporate proxy

Allowlist both `github.com` and `objects.githubusercontent.com`; release assets redirect to the
latter.

`HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` are honoured, as are npm's own `proxy`, `https-proxy` and
`noproxy` settings when the command runs through npm. Proxy support uses
`http.setGlobalProxyFromEnv()`, which needs Node.js 24.14.0 or newer.

A custom certificate authority cannot be configured at runtime; start Node with
`NODE_EXTRA_CA_CERTS=/path/to/ca.pem`. If the proxy answers with an HTML login page instead of the
archive, the error names it explicitly rather than failing with an opaque archive error.

### Fully offline installs

Prime the cache on a connected machine and copy it across:

```sh
WASM_OPT_CACHE_DIR=/shared/wasm-opt-cache npx wasm-opt --wasm-opt-install
```

Or serve the archives from an internal host:

```sh
export WASM_OPT_BINARY_URL=https://artifacts.internal/binaryen-version_132-x86_64-linux.tar.gz
export WASM_OPT_SHA256=<digest>
npx wasm-opt --wasm-opt-install
```

Vendoring `@wasm-opt/<platform>-<arch>` into a private registry works too and needs no cache at all.

### Alpine or another musl distribution

There is no native build. Install `@wasm-opt/wasm`.

## Licence

This package is MIT licensed. The binaries it distributes are Binaryen, which is licensed under the
Apache License 2.0. See
[Binaryen's LICENSE](https://github.com/WebAssembly/binaryen/blob/main/LICENSE). Binaryen is a
project of the WebAssembly Community Group; this package is not affiliated with it.
