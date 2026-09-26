import fs from 'node:fs';
import { formatJson } from '../formatter.js';
import { processAgentEvent } from '../events/gateway.js';

/**
 * Handler for `rewind event [--json] [--data <json>] [--file <path>]`.
 * Reads agent hook failure payloads from stdin, file, or flag,
 * processes them through the Gateway pipeline, and outputs machine-readable JSON.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function eventCommand({ context }) {
  const { parsedArgs, storage, stdin, stdout, config } = context;

  let rawData = parsedArgs.flags.data || '';

  if (!rawData && parsedArgs.flags.file) {
    try {
      rawData = fs.readFileSync(parsedArgs.flags.file, 'utf8');
    } catch (err) {
      stdout.write(formatJson({ error: `Failed to read event file: ${err.message}` }) + '\n');
      return 1;
    }
  }

  if (!rawData && stdin) {
    rawData = await readStream(stdin);
  }

  const result = processAgentEvent(rawData, storage, {
    cwd: parsedArgs.flags.cwd || config?.rootDir || process.cwd()
  });

  stdout.write(formatJson(result) + '\n');
  return 0;
}

function readStream(stream) {
  return new Promise((resolve) => {
    let buf = '';
    if (stream.isTTY) {
      resolve('');
      return;
    }
    stream.setEncoding?.('utf8');
    stream.on('data', (chunk) => { buf += chunk; });
    stream.on('end', () => resolve(buf));
    stream.on('error', () => resolve(buf));
    setTimeout(() => resolve(buf), 200);
  });
}
