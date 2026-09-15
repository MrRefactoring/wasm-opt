import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { resolveBinarySync } from './core/resolve.ts';
import { WasmOptError } from './errors.ts';

export type { Libc, NativeTarget, PlatformKey, Target, WasmTarget } from './core/platform.ts';
export type { BinaryInfo, BinarySource } from './core/resolve.ts';
export { BINARYEN_VERSION } from './core/version.ts';
export {
  BinaryNotFoundError,
  ChecksumMismatchError,
  DownloadError,
  ExtractionError,
  UnsupportedPlatformError,
  VersionUnavailableError,
  WasmOptError,
} from './errors.ts';

export interface WasmOptOptions {
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly stdin?: Uint8Array;
  readonly env?: NodeJS.ProcessEnv;
}

export interface WasmOptResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

export async function resolveBinary(
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<import('./core/resolve.ts').BinaryInfo> {
  return resolveBinarySync(options);
}

export async function wasmOpt(
  args: readonly string[],
  options: WasmOptOptions = {},
): Promise<WasmOptResult> {
  const binary = resolveBinarySync({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });

  return new Promise<WasmOptResult>((resolve, reject) => {
    const child = spawn(binary.command, [...binary.args, ...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.once('error', reject);

    child.once('close', (status, signal) => {
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

export async function optimize(
  input: Uint8Array,
  args: readonly string[] = ['-O'],
): Promise<Uint8Array> {
  const result = await wasmOpt(['-', ...args, '-o', '-'], { stdin: input });

  if (result.status !== 0) {
    throw new WasmOptError(
      `wasm-opt exited with ${result.signal ? `signal ${result.signal}` : `status ${result.status}`}: ${result.stderr.trim() || 'no diagnostics on stderr'}`,
    );
  }

  return result.stdout;
}
