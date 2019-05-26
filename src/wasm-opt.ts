#!/usr/bin/env node
import { join } from 'path';
import { spawn } from 'child_process';

const spawned = spawn(
  join(__dirname, 'wasm-opt'),
  process.argv.slice(2),
  { cwd: './', shell: true }
);

spawned.stdout.on('data', (data) => {
  console.log(`${data}`);
});

spawned.stderr.on('data', (data) => {
  console.log(`${data}`);
});
