const fetch = require('node-fetch');

async function getReleases(page) {
  const response = await fetch(`https://api.github.com/repos/WebAssembly/binaryen/releases?page=${page || 1}`);
  const releases = await response.json();

  return {
    next: releases && releases.length && (async () => getReleases((page || 1) + 1)),
    prev: page && page > 1 && (async () => getReleases(page - 1)),
    releases,
  };
}

async function getRelease(version) {
  version = version || '1';

  const [major, minor, bugfix] = version.split('.').map(version => +version);

  let { releases, next } = await getReleases();

  while (!!(releases && releases.length)) {
    const release = releases.find(release => {
      const [ma, mi = minor, bf = bugfix] = release.tag_name.split('.').map(version => +version);

      return major === ma && (minor || mi) === mi && (bugfix || bf) === bf;
    });

    if (!!release) {
      return release;
    } else if (!!next) {
      response = await next();

      releases = response.releases;
      next = response.next;
    } else {
      break;
    }
  }

  throw new Error('The release is not found');
}

module.exports = { getRelease };
