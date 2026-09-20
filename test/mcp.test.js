import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, PassThrough } from 'node:stream';
import { parseMessage, createResponse, createErrorResponse, ErrorCodes } from '../src/mcp/protocol.js';
import { startMcpServer } from '../src/mcp/server.js';

function createMockStorage() {
  const records = new Map();
  records.set('1', {
    id: '1',
    command: 'npm',
    args: ['test'],
    fullCommand: 'npm test',
    exitCode: 1,
    status: 'OPEN',
    fingerprint: 'abc123',
    createdAt: new Date().toISOString(),
    recoveryAttempts: []
  });
  
  return {
    getRecord(id) { return records.get(String(id)) || null; },
    listRecords(opts = {}) {
      const all = Array.from(records.values());
      return { records: all.slice(0, opts.limit || all.length), total: all.length };
    },
    getAgentContext(target) {
      return { status: 'success', contextSchemaVersion: '1.0.0', query: { target } };
    },
    addRecoveryAttempt(id, data) {
      const record = records.get(String(id));
      if (!record) throw new Error(`Not found: ${id}`);
      record.recoveryAttempts.push({ ...data, attemptId: 1 });
      return record;
    }
  };
}

// Utility to run the server on given inputs and collect outputs
async function runServerWithInput(inputs, storage = createMockStorage()) {
  const stdin = Readable.from(inputs.join('\n') + '\n');
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  
  const outputLines = [];
  stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) outputLines.push(line.trim());
    }
  });

  await startMcpServer(storage, { stdin, stdout, stderr });
  
  return outputLines.map(line => JSON.parse(line));
}

test('MCP Protocol Tests', async (t) => {
  await t.test('parseMessage with valid JSON', () => {
    const msg = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    assert.deepEqual(msg, { jsonrpc: '2.0', id: 1, method: 'ping' });
  });

  await t.test('parseMessage with invalid JSON-RPC version', () => {
    assert.throws(() => {
      parseMessage('{"jsonrpc":"1.0","id":1,"method":"ping"}');
    }, /Invalid JSON-RPC version/);
  });

  await t.test('createResponse formats correctly', () => {
    const res = createResponse(1, { foo: 'bar' });
    assert.equal(res, '{"jsonrpc":"2.0","id":1,"result":{"foo":"bar"}}');
  });

  await t.test('createErrorResponse formats correctly', () => {
    const res = createErrorResponse(1, -32600, 'Invalid');
    assert.equal(res, '{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Invalid"}}');
  });
});

test('MCP Server Tests', async (t) => {
  await t.test('initialize handshake', async () => {
    const inputs = ['{"jsonrpc":"2.0","id":1,"method":"initialize"}'];
    const outputs = await runServerWithInput(inputs);
    
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].id, 1);
    assert.ok(outputs[0].result.protocolVersion);
    assert.ok(outputs[0].result.capabilities);
  });

  await t.test('tools/list returns all 5 tool definitions', async () => {
    const inputs = ['{"jsonrpc":"2.0","id":1,"method":"tools/list"}'];
    const outputs = await runServerWithInput(inputs);
    
    assert.equal(outputs.length, 1);
    const tools = outputs[0].result.tools;
    assert.equal(tools.length, 5);
    
    const names = tools.map(t => t.name).sort();
    assert.deepEqual(names, [
      'rewind_context',
      'rewind_history',
      'rewind_recover',
      'rewind_search',
      'rewind_show'
    ]);
  });

  await t.test('tools/call rewind_context', async () => {
    const inputs = ['{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"rewind_context","arguments":{"incidentId":"1"}}}'];
    const outputs = await runServerWithInput(inputs);
    
    const content = outputs[0].result.content;
    assert.equal(content.length, 1);
    assert.equal(content[0].type, 'text');
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.query.target, '1');
  });

  await t.test('tools/call rewind_search', async () => {
    const inputs = ['{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rewind_search","arguments":{"query":"test"}}}'];
    const outputs = await runServerWithInput(inputs);
    
    const content = outputs[0].result.content;
    assert.equal(content[0].type, 'text');
  });

  await t.test('tools/call rewind_history', async () => {
    const inputs = ['{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"rewind_history","arguments":{"limit":5}}}'];
    const outputs = await runServerWithInput(inputs);
    
    const content = outputs[0].result.content;
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.records.length, 1);
  });

  await t.test('tools/call rewind_show', async () => {
    const inputs = ['{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"rewind_show","arguments":{"incidentId":"1"}}}'];
    const outputs = await runServerWithInput(inputs);
    
    const content = outputs[0].result.content;
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.id, '1');
  });

  await t.test('tools/call rewind_recover', async () => {
    const inputs = ['{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"rewind_recover","arguments":{"incidentId":"1","cause":"bad","change":"fixed"}}}'];
    const outputs = await runServerWithInput(inputs);
    
    const content = outputs[0].result.content;
    const parsed = JSON.parse(content[0].text);
    assert.equal(parsed.id, '1');
    assert.equal(parsed.recoveryAttempts.length, 1);
    assert.equal(parsed.recoveryAttempts[0].cause, 'bad');
  });

  await t.test('unknown method returns METHOD_NOT_FOUND error', async () => {
    const inputs = ['{"jsonrpc":"2.0","id":7,"method":"invalid/method"}'];
    const outputs = await runServerWithInput(inputs);
    
    assert.equal(outputs[0].error.code, ErrorCodes.METHOD_NOT_FOUND);
  });

  await t.test('invalid JSON returns PARSE_ERROR', async () => {
    const inputs = ['{"jsonrpc":"2.0",'];
    const outputs = await runServerWithInput(inputs);
    
    assert.equal(outputs[0].error.code, ErrorCodes.PARSE_ERROR);
  });

  await t.test('ping returns empty object', async () => {
    const inputs = ['{"jsonrpc":"2.0","id":9,"method":"ping"}'];
    const outputs = await runServerWithInput(inputs);
    
    assert.deepEqual(outputs[0].result, {});
  });
});
