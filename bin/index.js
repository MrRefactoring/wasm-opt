const fs = require('fs');
const tar = require('tar');
const path = require('path');
const fetch = require('node-fetch');
const { promisify } = require('util');

const copyFile = promisify(fs.copyFile);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

/**
 * Creates URL for wasm-opt binary
 *
 * @returns {Promise<string>} binary url
 */
async function getUrl() {
  const { arch, platform } = process;

  switch (platform) {
    case 'win32':
      if (arch === 'x64') {
        return 'https://github.com/WebAssembly/binaryen/releases/download/1.39.1/binaryen-1.39.1-x86_64-windows.tar.gz';
      } else if (arch === 'x32') {
        return 'https://github.com/WebAssembly/binaryen/releases/download/1.39.1/binaryen-1.39.1-x86-windows.tar.gz';
      }
    case 'darwin':
      if (arch === '64') {
        return 'https://github.com/WebAssembly/binaryen/releases/download/1.39.1/binaryen-1.39.1-x86_64-apple-darwin.tar.gz';
      }
    case 'linux':
      if (arch === 'x64') {
        return 'https://github.com/WebAssembly/binaryen/releases/download/1.39.1/binaryen-1.39.1-x86_64-linux.tar.gz';
      } else if (arch === 'x32') {
        return 'https://github.com/WebAssembly/binaryen/releases/download/1.39.1/binaryen-1.39.1-x86-linux.tar.gz';
      }
  }

  console.log('\x1b[33mThis platform not supported\x1b[0m');
  process.exit();
}

/**
 * Returns wasm-opt or wasm-opt.exe string
 *
 * @returns {Promise<string>} name
 */
async function getExecutableFilename() {
  return process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
}

/**
 * Returns unpack folder name
 *
 * @returns {Promise<string>} unpack folder name
 */
async function getUnpackedFoldername() {
  if (process.platform !== 'win32') {
    return 'binaryen-1.39.1';
  }

  if (process.arch === 'x64') {
    return 'binaryen-1.39.1-x86_64-windows';
  } else {
    return 'binaryen-1.39.1-x86-windows';
  }
}

/**
 * Downloads binaries
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
      filter: (_path, stat) => stat.header
        .path
        .split('/')
        .includes(executableFilename),
    });

    const unpackedFolder = path.resolve(__dirname, '..', await getUnpackedFoldername());
    const downloadedWasmOpt = path.resolve(unpackedFolder, executableFilename);
    const outputWasmOpt = path.resolve(__dirname, await getExecutableFilename());

    await copyFile(downloadedWasmOpt, outputWasmOpt);

    await unlink(binariesOutputPath);
    await unlink(downloadedWasmOpt);
    await rmdir(unpackedFolder);
  } catch (e) {
    console.error(`\x1b[31m${e}\x1b[0m`);
    process.exit(1);
  }
}

main();
