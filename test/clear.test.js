import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { clearCommand } from '../src/commands/clear.js';
import { StorageEngine } from '../src/storage/store.js';
import { createStyler } from '../src/formatter.js';

/**
 * Creates a temporary ledger directory with a storage engine for testing.
 *
 * @returns {{ tmpDir: string, ledgerDir: string, storage: StorageEngine }}
 */
function createTempLedger() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-clear-test-'));
  const ledgerDir = path.join(tmpDir, '.rewind');
  const storage = new StorageEngine(ledgerDir);
  storage.init();
  return { tmpDir, ledgerDir, storage };
}

/**
 * Creates a mock CliContext for testing.
 *
 * @param {object} opts
 * @returns {object}
 */
function createMockContext(opts = {}) {
  let output = '';
  let errOutput = '';
  const stdout = {
    write(data) { output += data; return true; },
    get content() { return output; }
  };
  const stderr = {
    write(data) { errOutput += data; return true; },
    get content() { return errOutput; }
  };

  return {
    context: {
      parsedArgs: {
        command: 'clear',
        positional: [],
        flags: opts.flags || {},
        raw: []
      },
      storage: opts.storage,
      config: { ledgerDir: opts.ledgerDir },
      stdout,
      stderr,
      stdin: opts.stdin || process.stdin,
      styler: createStyler(false),
      isTTY: opts.isTTY !== undefined ? opts.isTTY : false,
      cwd: opts.tmpDir || os.tmpdir()
    },
    getOutput: () => output,
    getErrOutput: () => errOutput
  };
}

describe('rewind clear', () => {
  let tmpDir, ledgerDir, storage;

  beforeEach(() => {
    const env = createTempLedger();
    tmpDir = env.tmpDir;
    ledgerDir = env.ledgerDir;
    storage = env.storage;
  });

  afterEach(() => {
    try {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    } catch {
      // Ignore cleanup errors
    }
  });

  it('clears ledger with --force flag', async () => {
    // Verify ledger exists
    assert.ok(fs.existsSync(ledgerDir));

    const { context, getOutput } = createMockContext({
      flags: { force: true },
      storage,
      ledgerDir,
      tmpDir
    });

    const code = await clearCommand({ context });
    assert.equal(code, 0);
    assert.ok(!fs.existsSync(ledgerDir), 'Ledger should be deleted');
    assert.ok(getOutput().includes('Ledger cleared'), 'Should confirm deletion');
  });

  it('outputs JSON on --force --json', async () => {
    const { context, getOutput } = createMockContext({
      flags: { force: true, json: true },
      storage,
      ledgerDir,
      tmpDir
    });

    const code = await clearCommand({ context });
    assert.equal(code, 0);

    const parsed = JSON.parse(getOutput());
    assert.equal(parsed.status, 'success');
    assert.equal(typeof parsed.cleared.incidents, 'number');
    assert.ok(!fs.existsSync(ledgerDir));
  });

  it('rejects --json without --force', async () => {
    const { context, getOutput } = createMockContext({
      flags: { json: true },
      storage,
      ledgerDir,
      tmpDir
    });

    const code = await clearCommand({ context });
    assert.equal(code, 1);
    assert.ok(getOutput().includes('--force'));
  });

  it('rejects non-interactive without --force', async () => {
    const { context, getErrOutput } = createMockContext({
      flags: {},
      storage,
      ledgerDir,
      tmpDir,
      isTTY: false
    });

    const code = await clearCommand({ context });
    assert.equal(code, 1);
    assert.ok(getErrOutput().includes('--force'));
    assert.ok(fs.existsSync(ledgerDir), 'Ledger should NOT be deleted');
  });

  it('handles non-existent ledger gracefully', async () => {
    try { fs.rmSync(ledgerDir, { recursive: true, force: true }); } catch {}

    const { context, getOutput } = createMockContext({
      flags: {},
      storage,
      ledgerDir: path.join(tmpDir, 'nonexistent'),
      tmpDir
    });

    const code = await clearCommand({ context });
    assert.equal(code, 0);
    assert.ok(getOutput().includes('Nothing to clear'));
  });
});
