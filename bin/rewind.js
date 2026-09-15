#!/usr/bin/env node

import { runCLI } from '../src/cli.js';

// Suppress SQLite ExperimentalWarning
const originalEmit = process.emit;
process.emit = function (name, data, ...args) {
  if (name === 'warning' && typeof data === 'object' && data.name === 'ExperimentalWarning' && data.message.includes('SQLite')) {
    return false;
  }
  return originalEmit.apply(process, [name, data, ...args]);
};

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    process.exit(0);
  }
});

const exitCode = await runCLI(process.argv.slice(2));
process.exitCode = exitCode;
