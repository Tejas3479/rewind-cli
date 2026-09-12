/**
 * Parses a JSON-RPC 2.0 message string.
 * @param {string} line - Raw JSON line
 * @returns {object} Parsed message with { jsonrpc, id, method, params }
 */
export function parseMessage(line) {
  const msg = JSON.parse(line);
  if (msg.jsonrpc !== '2.0') {
    throw new Error('Invalid JSON-RPC version');
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
export function createErrorResponse(id, code, message, data) {
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

// Standard JSON-RPC error codes
export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};
