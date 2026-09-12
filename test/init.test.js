import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initCommand } from '../src/commands/init.js';

describe('rewind init command', () => {
  test('initializes empty ledger and updates gitignore', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-init-'));
    try {
      const gitignorePath = path.join(tmpDir, '.gitignore');
      fs.writeFileSync(gitignorePath, 'node_modules/\n');

      let stdoutData = '';
      const context = {
        cwd: tmpDir,
        storage: {
          ledgerDir: path.join(tmpDir, '.rewind'),
          listRecords: () => ({ records: [], total: 0 })
        },
        styler: {
          green: (t) => t,
          bold: (t) => t,
          cyan: (t) => t
        },
        stdout: {
          write: (text) => { stdoutData += text; }
        }
      };

      const exitCode = await initCommand({ context });
      assert.equal(exitCode, 0);

      const gitignore = fs.readFileSync(gitignorePath, 'utf8');
      assert.ok(gitignore.includes('.rewind/'));

      assert.ok(stdoutData.includes('Initialized empty Rewind ledger'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('detects already initialized ledger', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-init2-'));
    try {
      const ledgerDir = path.join(tmpDir, '.rewind');
      fs.mkdirSync(ledgerDir);
      fs.writeFileSync(path.join(ledgerDir, 'journal.jsonl'), '{"type": "init"}\n');

      let stdoutData = '';
      const context = {
        cwd: tmpDir,
        storage: {
          ledgerDir,
          listRecords: () => ({ records: [], total: 0 })
        },
        styler: {
          green: (t) => t,
          bold: (t) => t,
          cyan: (t) => t
        },
        stdout: {
          write: (text) => { stdoutData += text; }
        }
      };

      const exitCode = await initCommand({ context });
      assert.equal(exitCode, 0);
      assert.ok(stdoutData.includes('already initialized'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
