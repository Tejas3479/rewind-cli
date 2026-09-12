#!/usr/bin/env node

import { runCLI } from '../src/cli.js';

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    process.exit(0);
  }
});

const exitCode = await runCLI(process.argv.slice(2));
process.exitCode = exitCode;
