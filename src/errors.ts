export class WasmOptError extends Error {
  override name = 'WasmOptError';
}

export class UnsupportedPlatformError extends WasmOptError {
  override name = 'UnsupportedPlatformError';
}

export class BinaryNotFoundError extends WasmOptError {
  override name = 'BinaryNotFoundError';
}

export class InvalidOverrideError extends WasmOptError {
  override name = 'InvalidOverrideError';
}

export class VersionUnavailableError extends WasmOptError {
  override name = 'VersionUnavailableError';
}

export class DownloadError extends WasmOptError {
  override name = 'DownloadError';

  readonly url: string;
  readonly status: number | undefined;
  readonly bodyPreview: string | undefined;

  constructor(
    message: string,
    details: { url: string; status?: number; bodyPreview?: string; cause?: unknown },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.url = details.url;
    this.status = details.status;
    this.bodyPreview = details.bodyPreview;
  }
}

export class ChecksumMismatchError extends WasmOptError {
  override name = 'ChecksumMismatchError';

  readonly expected: string;
  readonly actual: string;

  constructor(message: string, details: { expected: string; actual: string; cause?: unknown }) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.expected = details.expected;
    this.actual = details.actual;
  }
}

export class ExtractionError extends WasmOptError {
  override name = 'ExtractionError';
}
