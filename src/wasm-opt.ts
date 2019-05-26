#!/usr/bin/env node
import { spawn } from 'child_process';

const isWin = process.platform === 'win32';

const wasmOpt = isWin ? 'wasm-opt.exe' : 'wasm-opt';

const spawned = spawn(wasmOpt, process.argv.slice(2));

spawned.stdout.on('data', (data) => {
  console.log(`${data}`);
});

spawned.stderr.on('data', (data) => {
  console.log(`${data}`);
});
