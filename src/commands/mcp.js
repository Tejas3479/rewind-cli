import { startMcpServer } from '../mcp/server.js';

/**
 * Handler for `rewind mcp`.
 * Starts the MCP (Model Context Protocol) server in stdio mode.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function mcpCommand({ context }) {
  const { storage, stdin, stdout, stderr } = context;
  
  await startMcpServer(storage, { stdin, stdout, stderr });
  
  return 0;
}
