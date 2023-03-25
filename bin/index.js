const fs = require('fs');
const tar = require('tar');
const path = require('path');
const fetch = require('node-fetch');
const { promisify } = require('util');

const mkdir = promisify(fs.mkdir);
const copyFile = promisify(fs.copyFile);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);
const exists = promisify(fs.exists);

const { platform } = process;

const BINARYEN_VERSION = 112;

/**
 * Creates a URL for the wasm-opt binary based on the current operating system and architecture.
 * @throws {Error} If the platform is not supported
 * @returns {Promise<string>} The binary URL
 */
async function getUrl() {
  const { arch } = process;
  const baseURL = `https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}`;

  switch (platform) {
    case 'win32':
      if (arch === 'x64') {
        return `${baseURL}/binaryen-version_${BINARYEN_VERSION}-x86_64-windows.tar.gz`;
      }
      break;
    case 'darwin':
      if (arch === 'arm64') {
        return `${baseURL}/binaryen-version_${BINARYEN_VERSION}-arm64-macos.tar.gz`;
      }
      if (arch === 'x64') {
        return `${baseURL}/binaryen-version_${BINARYEN_VERSION}-x86_64-macos.tar.gz`;
      }
      break;
    case 'linux':
      if (arch === 'x64') {
        return `${baseURL}/binaryen-version_${BINARYEN_VERSION}-x86_64-linux.tar.gz`;
      }
      break;
  }

  throw new Error('\x1b[33mThis platform not supported\x1b[0m');
}

/**
 * Returns the filename of the wasm-opt executable depending on the platform.
 * @async
 * @returns {Promise<string>} The filename of the wasm-opt executable.
 */
async function getExecutableFilename() {
  return platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
}

/**
 * Get the name of the folder containing the unpacked Binaryen distribution archive.
 * @async
 * @function
 * @returns {Promise<string>} The name of the unpacked folder, in the format binaryen-version_X.Y.Z.
 */
async function getUnpackedFolderName() {
  return `binaryen-version_${BINARYEN_VERSION}`;
}

/**
 * Downloads and extracts Binaryen binaries, including wasm-opt and libbinaryen.
 *
 * @throws {Error} If an error occurs during the download or extraction process.
 *
 * @returns {Promise<void>}
 */
async function main() {
  try {
    const executableFilename = await getExecutableFilename();
    const binariesOutputPath = path.resolve(__dirname, 'binaries.tar');

    const binaryUrl = await getUrl();
    const binaryResponse = await fetch(binaryUrl);
    const binary = await binaryResponse.buffer();

    await writeFile(binariesOutputPath, binary);

    await tar.extract({
      file: binariesOutputPath,
      filter: (_path, stat) => {
        const { path: filePath } = stat.header

        return [
          executableFilename,
          'libbinaryen.dylib',
          'libbinaryen.a',
          'binaryen.lib',
        ].some((filename) => filePath.endsWith(filename));
      }
    });

    const libName = {
      win32: 'binaryen.lib',
      linux: 'libbinaryen.a',
      darwin: 'libbinaryen.dylib',
    };

    const libFolder = 'lib';

    const unpackedFolder = path.resolve(__dirname, '..', await getUnpackedFolderName());
    const unpackedLibFolder = path.resolve(unpackedFolder, libFolder);
    const unpackedBinFolder = path.resolve(unpackedFolder, 'bin');
    const downloadedWasmOpt = path.resolve(unpackedBinFolder, executableFilename);
    const downloadedLibbinaryen = path.resolve(unpackedLibFolder, libName[platform]);
    const outputWasmOpt = path.resolve(__dirname, await getExecutableFilename());
    const outputLibbinaryen = path.resolve(__dirname, `../${libFolder}/${libName[platform]}`);

    const outFolder = path.resolve(__dirname, `../${libFolder}`);

    if (!(await exists(outFolder))) {
      await mkdir(outFolder);
    }

    await copyFile(downloadedWasmOpt, outputWasmOpt);
    await copyFile(downloadedLibbinaryen, outputLibbinaryen);

    await unlink(binariesOutputPath);
    await unlink(downloadedWasmOpt);
    await unlink(downloadedLibbinaryen);
    await rmdir(unpackedBinFolder);
    await rmdir(unpackedLibFolder);
    await rmdir(unpackedFolder);
  } catch (e) {
    throw new Error(`\x1b[31m${e}\x1b[0m`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
