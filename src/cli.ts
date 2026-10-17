#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { styleText } from 'node:util';
import { currentTarget, describePlatform } from './core/platform.ts';
import { resolveBinarySync } from './core/resolve.ts';
import {
  BinaryNotFoundError,
  InvalidOverrideError,
  UnsupportedPlatformError,
  VersionUnavailableError,
  WasmOptError,
} from './errors.ts';

const DOCS = 'https://github.com/MrRefactoring/wasm-opt#troubleshooting';
const OWN_FLAGS = new Set(['--wasm-opt-info', '--wasm-opt-install']);

function paint(format: Parameters<typeof styleText>[0], text: string): string {
  return process.stderr.isTTY ? styleText(format, text) : text;
}

function troubleshooting(): string {
  const native = currentTarget();

  const lines = native
    ? [
        `The platform package ${native.packageName} is not installed.`,
        '',
        'Install scripts are disabled by default in npm >= 12 and pnpm >= 10, but',
        'wasm-opt ships no install scripts at all: the binary is delivered through',
        'optionalDependencies. A missing platform package usually means the install',
        'ran with --no-optional, or the lockfile omits it.',
        '',
        'Try one of:',
        '  npm install                           # re-resolve optional dependencies',
        '  npx wasm-opt --wasm-opt-install       # download it now',
        '  npm i -D @wasm-opt/wasm               # portable build, works anywhere',
        '  WASM_OPT_PATH=/path/to/wasm-opt       # use an existing binary',
      ]
    : [
        'Try one of:',
        '  npm i -D @wasm-opt/wasm               # portable build, works anywhere',
        '  npx wasm-opt --wasm-opt-install       # download that build into the shared cache',
        '  WASM_OPT_PATH=/path/to/wasm-opt       # use an existing binary',
      ];

  return [...lines, '', DOCS].join('\n');
}

function explain(error: unknown): string {
  const headline = error instanceof Error ? error.message : String(error);

  if (error instanceof InvalidOverrideError) {
    return [
      `${paint('red', 'wasm-opt:')} ${headline}`,
      '',
      'Try one of:',
      '  unset WASM_OPT_PATH                   # fall back to the packaged binary',
      '  WASM_OPT_PATH=/path/to/wasm-opt       # point it at a binary that exists',
      '',
      DOCS,
    ].join('\n');
  }

  if (error instanceof BinaryNotFoundError || error instanceof UnsupportedPlatformError) {
    return `${paint('red', 'wasm-opt:')} ${headline}\n\n${troubleshooting()}`;
  }

  if (error instanceof VersionUnavailableError) {
    return [
      `${paint('red', 'wasm-opt:')} ${headline}`,
      '',
      'Try one of:',
      '  npx wasm-opt --wasm-opt-install       # download the requested version',
      '  unset WASM_OPT_VERSION                # use the version that ships with this package',
      '',
      DOCS,
    ].join('\n');
  }

  if (error instanceof WasmOptError) {
    return [
      `${paint('red', 'wasm-opt:')} ${headline}`,
      '',
      'Try one of:',
      '  WASM_OPT_FORCE=1 npx wasm-opt --wasm-opt-install   # discard what is cached and fetch again',
      '  WASM_OPT_PATH=/path/to/wasm-opt                    # use an existing binary',
      '',
      DOCS,
    ].join('\n');
  }

  return `${paint('red', 'wasm-opt:')} ${headline}`;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const only = argv.length === 1 ? argv[0] : undefined;

if (only !== undefined && OWN_FLAGS.has(only)) {
  try {
    const installer = await import('./install.ts');
    await (only === '--wasm-opt-info' ? installer.printInfo() : installer.runInstall());
    process.exit(0);
  } catch (error) {
    fail(explain(error));
  }
}

let binary: ReturnType<typeof resolveBinarySync>;

try {
  binary = resolveBinarySync();
} catch (error) {
  fail(explain(error));
}

const child = spawn(binary.command, [...binary.args, ...argv], {
  stdio: 'inherit',
  env: { ...process.env, WASM_OPT_CHILD: '1' },
});

const interrupt = () => child.kill('SIGINT');
const terminate = () => child.kill('SIGTERM');
const stopForwarding = () => {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
};

process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);

child.once('error', (error) => {
  stopForwarding();
  fail(
    `${paint('red', 'wasm-opt:')} failed to run ${binary.path} on ${describePlatform()}: ${error.message}`,
  );
});

child.once('close', (status, signal) => {
  stopForwarding();

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(status ?? 1);
});
