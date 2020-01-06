import fetch from 'node-fetch';
import ora from 'ora';

interface IRelease {
  url: string;
  assets_url: string;
  upload_url: string;
  html_url: string;
  id: number;
  node_id: string;
  tag_name: string;
  target_commitish: string;
  name: string | null;
  draft: boolean;
  author: {
    [key: string]: any;
  };
  prerelease: boolean;
  created_at: string;
  published_at: string;
  assets: [{
    url: string;
    id: number;
    node_id: string;
    name: string;
    label: string;
    uploader: any;
    content_type: string;
    state: string;
    size: number;
    download_count: number;
    created_at: string;
    updated_at: string;
    browser_download_url: string;
  }];
  tarball_url: string;
  zipball_url: string;
  body: any | null;
}

interface IReleases {
  next: (() => Promise<IReleases>) | null;
  previous: (() => Promise<IReleases>) | null;
  assets: IRelease[];
}

export namespace Releases {
  export const getRelease = async (version?: string): Promise<IRelease> => {
    const spinner = ora('Finding the right release').start();

    let release;
    let releases = await getReleases();
    const [major, minor, bugfix] = version && version.split('.').map(el => +el) ||
      [1, undefined, undefined];

    while (!release && releases.assets.length) {
      release = releases.assets.find(rel => {
        const [ma, mi, bf] = rel.tag_name.split('.').map(el => +el);

        return major === ma && (minor || mi) === mi && (bugfix || bf) === bf;
      });

      if (!releases.next) {
        break;
      }

      releases = await releases.next();
    }

    if (release) {
      spinner.succeed('Release success found');
      return release;
    } else {
      spinner.fail('No matching release found');
      throw new Error('No matching release found');
    }
  };

  const getReleases = async (page?: number): Promise<IReleases> => {
    const list = await fetch(`https://api.github.com/repos/WebAssembly/binaryen/releases?page=${page || 1}`);

    if (list.status !== 200) {
      throw new Error(list.statusText);
    }

    const assets = await list.json() as IRelease[];

    return {
      next: assets.length ? async () => getReleases((page || 1) + 1) : null,
      previous: page && page > 1 ? async () => getReleases(page - 1) : null,
      assets
    };
  };
}
