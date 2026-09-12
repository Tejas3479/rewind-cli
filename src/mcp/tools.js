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
  try {
    let result;

    switch (toolName) {
      case 'rewind_context': {
        const target = args.incidentId || 'latest';
        result = await storage.getAgentContext(target, {});
        break;
      }
      
      case 'rewind_search': {
        if (!args.query) throw new Error('Missing query parameter');
        const listRes = await storage.listRecords();
        const records = listRes.records || [];
        result = searchRecords(args.query, records, { limit: args.limit });
        break;
      }
      
      case 'rewind_recover': {
        if (!args.incidentId || !args.cause || !args.change) {
          throw new Error('Missing required parameters (incidentId, cause, change)');
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
        result = await storage.listRecords({ limit: args.limit || 10, reverse: true });
        break;
      }
      
      case 'rewind_show': {
        if (!args.incidentId) throw new Error('Missing incidentId parameter');
        result = await storage.getRecord(args.incidentId);
        break;
      }
      
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
}
