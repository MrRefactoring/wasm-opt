import ora from 'ora';
import * as fs from 'fs';
import * as os from 'os';
import * as tar from 'tar';
import { Releases } from './releases';
import { Network } from './network';

const buildAssetName = (
  platform: string,
  architecture: string,
  version: string
): string => {
  const platforms: { [key: string]: string } = {
    darwin: 'apple-darwin',
    win32: 'windows',
    linux: 'linux',
  };

  return `binaryen-${version}-${architecture === 'x64' ? 'x86_64' : 'x86'}-${platforms[platform]}.tar.gz`
};

const buildFilename = (version: string) => `binaryen-${version}.tar.gz`;

(async () => {
  const releases = await Releases.getRelease('1');

  const version = releases.tag_name;
  const platform = process.platform;
  const architecture = os.arch();

  if (platform === 'darwin' && architecture === 'x86') {
    throw new Error('x86 macOs are not supported');
  }

  const wasmOpt = platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
  const assetName = buildAssetName(platform, architecture, version);
  const filename = buildFilename(version);
  const foldername = filename.replace(/\.tar\.gz$/, '');

  const asset = releases.assets.find(asset => asset.name === assetName);

  if (!asset) {
    throw new Error('Release for current OS not found');
  }

  fs.writeFileSync(filename, await Network.downloadBinaries(asset.browser_download_url));

  const spinner = ora('Extracting').start();

  await tar.extract({
    file: filename,
    filter: (_, stat) => {
      return stat.header.path!.split('/').reverse()[0] === wasmOpt;
    }
  });

  spinner.succeed('Extracted');

  fs.unlinkSync(filename);
  fs.copyFileSync(`${foldername}/${wasmOpt}`, `./out/${wasmOpt}`);
  fs.unlinkSync(`${foldername}/${wasmOpt}`);
  fs.rmdirSync(foldername);
})();
