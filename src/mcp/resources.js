import { McpError, ErrorCodes } from './protocol.js';
import { runDoctorDiagnostics } from '../storage/doctor.js';

/**
 * Returns RFC 6570 parameterized resource templates for dynamic discovery.
 * @returns {Array<{ uriTemplate: string, name: string, description: string, mimeType: string }>}
 */
export function getResourceTemplates() {
  return [
    {
      uriTemplate: 'rewind://incidents/{id}',
      name: 'Incident Record',
      description: 'Complete structured record of a specific recorded incident',
      mimeType: 'application/json'
    },
    {
      uriTemplate: 'rewind://incidents/{id}/evidence',
      name: 'Incident Raw Evidence',
      description: 'Raw stdout/stderr execution log captured for an incident',
      mimeType: 'text/plain'
    }
  ];
}

/**
 * Returns the list of direct, concrete resources currently available.
 * @param {import('../storage/store.js').StorageEngine} storage
 * @returns {Promise<Array<{ uri: string, name: string, description: string, mimeType: string }>>}
 */
export async function getResourceList(storage) {
  const items = [
    {
      uri: 'rewind://incidents/latest',
      name: 'Latest Incident',
      description: 'Forensic context for the most recent failure',
      mimeType: 'application/json'
    },
    {
      uri: 'rewind://doctor/health',
      name: 'Ledger Health Report',
      description: 'System health, disk usage, and cryptographic audit status',
      mimeType: 'application/json'
    },
    {
      uri: 'rewind://patterns',
      name: 'Failure Patterns Report',
      description: 'Empirical failure clusters, flakiness diagnostics, and regression patterns',
      mimeType: 'application/json'
    }
  ];

  if (storage && typeof storage.listRecords === 'function') {
    const listRes = storage.listRecords({ limit: 20, reverse: true });
    const records = Array.isArray(listRes?.records) ? listRes.records : [];
    for (const r of records) {
      if (!r || !r.id) continue;
      items.push({
        uri: `rewind://incidents/${r.id}`,
        name: `Incident #${r.id} (${r.command || 'unknown'})`,
        description: `Status: ${r.status || 'UNKNOWN'} | Exit: ${r.exitCode ?? 'N/A'}`,
        mimeType: 'application/json'
      });
    }
  }

  return items;
}

/**
 * Reads the content of an MCP resource by URI.
 * @param {string} uri
 * @param {import('../storage/store.js').StorageEngine} storage
 * @returns {Promise<{ contents: Array<{ uri: string, mimeType: string, text: string }> }>}
 */
export async function readResource(uri, storage) {
  if (typeof uri !== 'string' || !uri) {
    throw new McpError(ErrorCodes.INVALID_PARAMS, 'Resource URI must be a non-empty string');
  }

  if (uri === 'rewind://incidents/latest') {
    if (!storage || typeof storage.getAgentContext !== 'function') {
      throw new McpError(ErrorCodes.INTERNAL_ERROR, 'Storage engine does not support getAgentContext');
    }
    const context = await storage.getAgentContext('latest', {});
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(context, null, 2)
      }]
    };
  }

  if (uri === 'rewind://doctor/health') {
    let report = null;
    if (storage && typeof storage.diagnoseHealth === 'function') {
      report = storage.diagnoseHealth();
    } else if (storage?.ledgerDir) {
      report = runDoctorDiagnostics(storage.ledgerDir, {});
    } else {
      report = { status: 'HEALTHY', summary: { passed: 0, warnings: 0, failures: 0 } };
    }
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(report, null, 2)
      }]
    };
  }

  if (uri === 'rewind://patterns') {
    let report = null;
    if (storage && typeof storage.getPatternReport === 'function') {
      report = storage.getPatternReport();
    } else {
      report = { patterns: [], patternFamiliesCount: 0 };
    }
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(report, null, 2)
      }]
    };
  }

  const match = uri.match(/^rewind:\/\/incidents\/([^/]+)(\/evidence)?$/);
  if (match) {
    const rawId = match[1];
    const isEvidence = Boolean(match[2]);

    let record = null;
    if (rawId === 'latest') {
      const listRes = storage?.listRecords?.({ limit: 1, reverse: true });
      record = listRes?.records?.[0] || null;
    } else {
      record = storage?.getRecord?.(rawId) || null;
    }

    if (!record) {
      throw new McpError(ErrorCodes.RESOURCE_NOT_FOUND, `Incident #${rawId} not found`);
    }

    if (isEvidence) {
      const text = ((record.stdout ? record.stdout + '\n' : '') + (record.stderr || '')).trim();
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text
        }]
      };
    }

    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(record, null, 2)
      }]
    };
  }

  throw new McpError(ErrorCodes.RESOURCE_NOT_FOUND, `Resource not found: ${uri}`);
}
