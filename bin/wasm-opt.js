#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const rootDir = path.resolve('../wasm-opt/bin/wasm-opt' + process.platform === 'win32' ? '.exe' : '');

const spawned = cp.spawn(
  fs.existsSync(rootDir) ? rootDir : path.join(__dirname, 'wasm-opt' + process.platform === 'win32' ? '.exe' : ''),
  process.argv.slice(2),
  { cwd: './', shell: process.platform === 'win32' }
);

spawned.stdout.on('data', (data) => {
  console.log(`${data}`);
});

spawned.stderr.on('data', (data) => {
  console.log(`${data}`);
});
