/**
 * Standard JSON-RPC 2.0 error codes and MCP-specific error codes.
 */
export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // MCP-specific protocol error codes (-32000 to -32099)
  RESOURCE_NOT_FOUND: -32002
};

/**
 * Custom error class representing a JSON-RPC 2.0 / MCP protocol error.
 */
export class McpError extends Error {
  /**
   * @param {number} code
   * @param {string} message
   * @param {object} [data]
   */
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    if (data !== undefined) {
      this.data = data;
    }
  }
}

/**
 * Parses a JSON-RPC 2.0 message string.
 * @param {string} line - Raw JSON line
 * @returns {object} Parsed message with { jsonrpc, id, method, params }
 */
export function parseMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    throw new McpError(ErrorCodes.PARSE_ERROR, 'Parse error: invalid JSON');
  }

  if (typeof msg !== 'object' || msg === null || msg.jsonrpc !== '2.0') {
    throw new McpError(ErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC version or malformed message');
  }
  return msg;
}

/**
 * Serializes a JSON-RPC 2.0 success response.
 * @param {string|number} id
 * @param {object} result
 * @returns {string} JSON string
 */
export function createResponse(id, result) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result
  });
}

/**
 * Serializes a JSON-RPC 2.0 error response.
 * @param {string|number|null} id
 * @param {number} code - JSON-RPC error code
 * @param {string} message
 * @param {object} [data]
 * @returns {string} JSON string
 */
export function createErrorResponse(id, code, message, data = undefined) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    error
  });
}
