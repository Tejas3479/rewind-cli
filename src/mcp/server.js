import readline from 'node:readline';
import { VERSION } from '../config.js';
import { parseMessage, createResponse, createErrorResponse, ErrorCodes, McpError } from './protocol.js';
import { getToolDefinitions, executeTool } from './tools.js';
import { getResourceList, getResourceTemplates, readResource } from './resources.js';
import { getPromptList, getPrompt } from './prompts.js';

const SERVER_NAME = 'rewind';
const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-11-25', '2026-07-28'];

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
      send(createErrorResponse(null, err.code || ErrorCodes.PARSE_ERROR, err.message));
      continue;
    }

    // JSON-RPC 2.0 Invariant: A notification is a Request object without an 'id' member.
    const isNotification = msg.id === undefined || msg.id === null;

    try {
      const result = await handleMessage(msg, storage);
      // Notifications expect no response object whatsoever
      if (!isNotification && result !== null) {
        send(createResponse(msg.id, result));
      }
    } catch (err) {
      // JSON-RPC 2.0 Invariant: Server MUST NOT reply to notifications, even on error.
      if (!isNotification) {
        send(createErrorResponse(
          msg.id,
          err.code || ErrorCodes.INTERNAL_ERROR,
          err.message || 'Internal error',
          err.data
        ));
      }
    }
  }
}

async function handleMessage(msg, storage) {
  switch (msg.method) {
    case 'initialize': {
      const clientProtocol = msg.params?.protocolVersion;
      const negotiatedVersion = SUPPORTED_PROTOCOLS.includes(clientProtocol)
        ? clientProtocol
        : SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1];

      return {
        protocolVersion: negotiatedVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false }
        },
        serverInfo: {
          name: SERVER_NAME,
          version: VERSION
        }
      };
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // Fire-and-forget notification

    case 'ping':
      return {};

    // --- TOOLS ---
    case 'tools/list':
      return { tools: getToolDefinitions() };

    case 'tools/call': {
      const { name, arguments: args } = msg.params || {};
      if (!name) {
        throw new McpError(ErrorCodes.INVALID_PARAMS, 'Missing required parameter: "name"');
      }
      return await executeTool(name, args || {}, storage);
    }

    // --- RESOURCES ---
    case 'resources/list':
      return { resources: await getResourceList(storage) };

    case 'resources/templates/list':
      return { resourceTemplates: getResourceTemplates() };

    case 'resources/read': {
      const uri = msg.params?.uri;
      if (!uri) {
        throw new McpError(ErrorCodes.INVALID_PARAMS, 'Missing required parameter: "uri"');
      }
      return await readResource(uri, storage);
    }

    // --- PROMPTS ---
    case 'prompts/list':
      return { prompts: getPromptList() };

    case 'prompts/get': {
      const { name, arguments: args } = msg.params || {};
      if (!name) {
        throw new McpError(ErrorCodes.INVALID_PARAMS, 'Missing required parameter: "name"');
      }
      return await getPrompt(name, args || {}, storage);
    }

    default:
      throw new McpError(ErrorCodes.METHOD_NOT_FOUND, `Unknown method: "${msg.method}"`);
  }
}
