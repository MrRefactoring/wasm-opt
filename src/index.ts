import * as fs from 'fs';
import * as tar from 'tar';
import ora from 'ora';
import { Releases } from './releases';
import { arch } from 'os';
import { Network } from './Network';

const buildName = (
  platform: string,
  architecture: string,
  version: string
): string => {
  const platforms: { [key: string]: string } = {
    darwin: 'apple-darwin',
    win32: 'windows',
    linux: 'linux'
  };

  return `binaryen-${version}-${architecture === 'x64' ? 'x86_64' : 'x86'}-${platforms[platform]}.tar.gz`
};

(async () => {
  const releases = await Releases.getRealise('1');

  const version = releases.tag_name;
  const platform = process.platform;
  const architecture = arch();

  if (platform === 'darwin' && architecture === 'x86') {
    throw new Error('x86 macOs are not supported');
  }

  const wasmOpt = platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
  const targzName = buildName(platform, architecture, version);
  const unzipedFolderName = targzName.replace(/\.tar\.gz$/, '');

  const asset = releases.assets.find(asset => asset.name === targzName);

  if (!asset) {
    throw new Error('Release for current OS not found');
  }

  fs.writeFileSync(targzName, await Network.downloadBinaries(asset.browser_download_url));

  const spinner = ora('Extracting').start();

  await tar.extract({
    file: targzName,
    filter: (_, stat) => {
      return stat.header.path!.split('/').reverse()[0] === wasmOpt;
    }
  });

  spinner.succeed('Extracted');

  fs.unlinkSync(targzName);
  fs.copyFileSync(`${unzipedFolderName}/${wasmOpt}`, `./out/${wasmOpt}`);
  fs.unlinkSync(`${unzipedFolderName}/${wasmOpt}`);
  fs.rmdirSync(unzipedFolderName);
})();
