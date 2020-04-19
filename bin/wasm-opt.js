#!/usr/bin/env node

const path = require('path');
const cp = require('child_process');

const spawned = cp.spawn(
  path.join(__dirname, 'wasm-opt'),
  process.argv.slice(2),
  { cwd: './', shell: true }
);

spawned.stdout.on('data', (data) => {
  console.log(`${data}`);
});

spawned.stderr.on('data', (data) => {
  console.log(`${data}`);
});
