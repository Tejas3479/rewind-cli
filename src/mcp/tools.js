import { searchRecords } from '../storage/search.js';

/**
 * Returns the MCP tool definitions array.
 * @returns {Array<object>}
 */
export function getToolDefinitions() {
  return [
    {
      name: 'rewind_context',
      description: 'Get full agent context for an incident',
      inputSchema: {
        type: 'object',
        properties: {
          incidentId: {
            type: 'string',
            description: 'Target incident ID or "latest" (defaults to latest failure)'
          }
        }
      }
    },
    {
      name: 'rewind_search',
      description: 'Search historical failures',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search terms or error message snippet'
          },
          limit: {
            type: 'number',
            description: 'Limit number of candidate matches'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'rewind_recover',
      description: 'Record a recovery hypothesis',
      inputSchema: {
        type: 'object',
        properties: {
          incidentId: {
            type: 'string',
            description: 'Incident ID to recover'
          },
          cause: {
            type: 'string',
            description: 'Suspected root cause'
          },
          change: {
            type: 'string',
            description: 'Remediation action taken'
          },
          verifyCmd: {
            type: 'string',
            description: 'Explicit verification command'
          }
        },
        required: ['incidentId', 'cause', 'change']
      }
    },
    {
      name: 'rewind_history',
      description: 'List recent incidents',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Limit number of entries displayed'
          }
        }
      }
    },
    {
      name: 'rewind_show',
      description: 'Show detailed incident info',
      inputSchema: {
        type: 'object',
        properties: {
          incidentId: {
            type: 'string',
            description: 'Incident ID to inspect'
          }
        },
        required: ['incidentId']
      }
    }
  ];
}

/**
 * Executes a tool call.
 * @param {string} toolName
 * @param {object} args
 * @param {import('../storage/store.js').StorageEngine} storage
 * @returns {Promise<object>} Tool result { content: [{ type: 'text', text: '...' }] }
 */
export async function executeTool(toolName, args, storage) {
  function throwProtocolError(msg) {
    const error = new Error(msg);
    error.code = -32602; // INVALID_PARAMS
    throw error;
  }

  try {
    let result;

    switch (toolName) {
      case 'rewind_context': {
        if (args.incidentId !== undefined && typeof args.incidentId !== 'string') {
          throwProtocolError('incidentId must be a string');
        }
        const target = args.incidentId || 'latest';
        result = await storage.getAgentContext(target, {});
        break;
      }
      
      case 'rewind_search': {
        if (!args.query) throwProtocolError('Missing query parameter');
        if (typeof args.query !== 'string') throwProtocolError('query must be a string');
        if (args.limit !== undefined && typeof args.limit !== 'number') {
          throwProtocolError('limit must be a number');
        }
        const listRes = await storage.listRecords();
        const records = listRes.records || [];
        result = searchRecords(args.query, records, { limit: args.limit });
        break;
      }
      
      case 'rewind_recover': {
        if (!args.incidentId || !args.cause || !args.change) {
          throwProtocolError('Missing required parameters (incidentId, cause, change)');
        }
        if (typeof args.incidentId !== 'string') throwProtocolError('incidentId must be a string');
        if (typeof args.cause !== 'string') throwProtocolError('cause must be a string');
        if (typeof args.change !== 'string') throwProtocolError('change must be a string');
        if (args.verifyCmd !== undefined && typeof args.verifyCmd !== 'string') {
          throwProtocolError('verifyCmd must be a string');
        }
        result = await storage.addRecoveryAttempt(args.incidentId, {
          cause: args.cause,
          change: args.change,
          verifyCmd: args.verifyCmd,
          status: 'PROPOSED'
        });
        break;
      }
      
      case 'rewind_history': {
        if (args.limit !== undefined && typeof args.limit !== 'number') {
          throwProtocolError('limit must be a number');
        }
        result = await storage.listRecords({ limit: args.limit || 10, reverse: true });
        break;
      }
      
      case 'rewind_show': {
        if (!args.incidentId) throwProtocolError('Missing incidentId parameter');
        if (typeof args.incidentId !== 'string') throwProtocolError('incidentId must be a string');
        result = await storage.getRecord(args.incidentId);
        break;
      }
      
      default: {
        throwProtocolError(`Unknown tool: ${toolName}`);
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    if (error.code === -32602) {
      throw error; // Rethrow protocol-level errors to be handled by server.js
    }
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
}
