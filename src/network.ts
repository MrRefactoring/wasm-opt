import ora from 'ora';
import fetch from 'node-fetch';

export namespace Network {
  export const downloadBinaries = async (url: string): Promise<Buffer> => {
    const spinner = ora({
      text: 'Downloading binaries'
    }).start();

    const response = await fetch(url);

    if (response.status !== 200) {
      spinner.fail('Fail to download binaries');
      throw new Error(response.statusText);
    }

    spinner.succeed('Binaries successfully downloaded');

    return response.buffer();
  };
}
