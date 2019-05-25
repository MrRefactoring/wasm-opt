import fetch from 'node-fetch';
import * as fs from 'fs';
import * as tar from 'tar';
import { platform as pl, arch as ar } from 'os';

const wasmOpt = 'wasm-opt.exe';

const releaseNameBuilder = async (release: any): Promise<string> => {
  const version = release.tag_name;
  const platform = pl() === 'win32' ? 'windows' : '';
  const arch = ar() === 'x64' ? 'x86_64' : 'x86';

  if (!platform) {
    throw Error(`\x1b[47m\x1b[30m
      Currently only windows are supported.
      If you need another platform, write about this in the issue.
      https://github.com/MrRefactoring/wasm-opt/issues \x1b[0m
    `);
  }

  return `binaryen-${version}-${arch}-${platform}.tar.gz`;
};

const downloadArchive = async (url: string): Promise<Buffer> => {
  console.log('Downloading last release of wasm-opt. Please wait...');
  const archiveRaw = await fetch(url);
  return archiveRaw.buffer();
};

(async () => {
  const response = await fetch('https://api.github.com/repos/WebAssembly/binaryen/releases/latest');
  const release = await response.json();

  const releaseName = await releaseNameBuilder(release);
  const releaseFolder = releaseName.replace(/\.tar\.gz$/, '');

  const releaseUrl = release
    .assets
    .find((asset: any) => asset.name === releaseName)
    .browser_download_url;

  fs.writeFileSync(releaseName, await downloadArchive(releaseUrl));

  await tar.extract({
    file: releaseName,
    filter: (_, e) => {
      return e.header.path!.split('/').reverse()[0] === 'wasm-opt.exe';
    }
  });

  fs.unlinkSync(releaseName);
  fs.copyFileSync(`${releaseFolder}/${wasmOpt}`, `./out/${wasmOpt}`);
  fs.unlinkSync(`${releaseFolder}/${wasmOpt}`);
})();
