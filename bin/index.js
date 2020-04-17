const fs = require('fs');
const tar = require('tar');
const path = require('path');
const fetch = require('node-fetch');
const { promisify } = require('util');
const { fallback } = require('./fallback');
const { getRelease } = require('./releases');

const unlink = promisify(fs.unlink);
const copyFile = promisify(fs.copyFile);
const writeFile = promisify(fs.writeFile);

const { platform } = process;

const wasmOpt = `wasm-opt${platform === 'win32' && '.exe' | ''}`
const outFilePath = path.resolve(__dirname, wasmOpt);
const outTarFilePath = path.resolve(__dirname, 'release.tar.gz');

const platforms = {
  darwin: 'apple-darwin',
  win32: 'windows',
  linux: 'linux',
};

function getTargetAssetName(version) {
  return `binaryen-${version}-x86_64-${platforms[platform]}.tar.gz`;
}

async function unpackAndSave(archiveBuffer) {
  await writeFile(outTarFilePath, archiveBuffer);
  await tar.extract({
    file: outTarFilePath,
    filter: (_, stat) => stat.header.path.split('/').reverse()[0] === wasmOpt,
  });

  await copyFile(path.join(outFilePath, wasmOpt), outFilePath);
  await unlink(outTarFilePath);
  await writeFile(outFilePath, undefined);
}

const main = async () => {
  try {
    const release = await getRelease();

    const assetName = getTargetAssetName(release.tag_name);
    const asset = release.assets.find(asset => asset.name === assetName);

    const response = await fetch(asset.browser_download_url);
    const archiveBuffer = await response.buffer();

    await unpackAndSave(archiveBuffer);
  } catch (e) {
    console.log('\x1b[32mCannot download latest version of wasm-opt. Using fallback\x1b[0m');

    const buffer = await fallback();

    await unpackAndSave(buffer);
  }
};

main();
