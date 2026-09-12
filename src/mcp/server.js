import readline from 'node:readline';
import { parseMessage, createResponse, createErrorResponse, ErrorCodes } from './protocol.js';
import { getToolDefinitions, executeTool } from './tools.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'rewind-mcp';
const SERVER_VERSION = '1.0.0';

/**
 * Starts the MCP server on stdin/stdout.
 * @param {import('../storage/store.js').StorageEngine} storage
 * @param {object} [options]
 * @param {NodeJS.ReadableStream} [options.stdin=process.stdin]
 * @param {NodeJS.WritableStream} [options.stdout=process.stdout]
 * @param {NodeJS.WritableStream} [options.stderr=process.stderr]
 * @returns {Promise<void>}
 */
export async function startMcpServer(storage, options = {}) {
  const input = options.stdin || process.stdin;
  const output = options.stdout || process.stdout;
  // stderr can be used for logging if needed
  
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  
  function send(msg) {
    output.write(msg + '\n');
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    
    let msg;
    try {
      msg = parseMessage(line);
    } catch (err) {
      send(createErrorResponse(null, ErrorCodes.PARSE_ERROR, 'Parse error'));
      continue;
    }

    try {
      const result = await handleMessage(msg, storage);
      if (result !== null) { // null means notification, no response needed
        send(createResponse(msg.id, result));
      }
    } catch (err) {
      send(createErrorResponse(msg.id, err.code || ErrorCodes.INTERNAL_ERROR, err.message));
    }
  }
}

async function handleMessage(msg, storage) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION
        }
      };
      
    case 'notifications/initialized':
      return null; // notification, no response
      
    case 'tools/list':
      return { tools: getToolDefinitions() };
      
    case 'tools/call': {
      const { name, arguments: args } = msg.params || {};
      if (!name) {
        throw { code: ErrorCodes.INVALID_PARAMS, message: 'Missing tool name' };
      }
      return await executeTool(name, args || {}, storage);
    }
    
    case 'resources/list':
      return { resources: [] };
      
    case 'ping':
      return {};
      
    default:
      throw { code: ErrorCodes.METHOD_NOT_FOUND, message: `Unknown method: ${msg.method}` };
  }
}
