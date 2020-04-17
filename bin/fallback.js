const fetch = require('node-fetch');

async function fallback() {
  const platformAreNotSupport = new Error(`${process.platform} are not support.`);

  const releases = {
    aix: () => { throw platformAreNotSupport },
    darwin: () => 'https://github.com/WebAssembly/binaryen/releases/download/1.39.1/binaryen-1.39.1-x86_64-apple-darwin.tar.gz',
    freebsd: () => { throw platformAreNotSupport },
    linux: () => 'https://github.com/WebAssembly/binaryen/releases/download/1.39.1/binaryen-1.39.1-x86_64-linux.tar.gz',
    openbsd: () => { throw platformAreNotSupport },
    sunos: () => { throw platformAreNotSupport },
    win32: () => 'https://github.com/WebAssembly/binaryen/releases/download/1.39.1/binaryen-1.39.1-x86_64-windows.tar.gz',
  };

  const response = await fetch(releases[process.platform]());

  return response.buffer();
}

module.exports = {
  fallback,
};
