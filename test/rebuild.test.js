import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StorageEngine } from '../src/storage/store.js';

describe('Projection Rebuild & Disposable Derived State (rewind rebuild)', () => {
  let tempDir;
  let ledgerDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-rebuild-test-'));
    ledgerDir = path.join(tempDir, '.rewind');
  });

  afterEach(() => {
    try {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    } catch {
      // Ignore cleanup error
    }
  });

  it('reconstructs all derived incident files when records/ directory is wiped', () => {
    const storage = new StorageEngine(ledgerDir);
    storage.init();

    // Create 3 incidents with recoveries and verification
    const rec1 = storage.saveRecord({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'Test 1 failed',
      cwd: tempDir
    });

    storage.addRecoveryAttempt(rec1.id, {
      cause: 'Missing environment variable',
      change: 'Added DB_PORT=5432',
      verifyCmd: 'npm test'
    });

    storage.recordVerificationRun(rec1.id, 1, {
      command: 'npm test',
      exitCode: 0,
      durationMs: 120,
      output: 'All tests passed'
    });

    const rec2 = storage.saveRecord({
      command: 'cargo',
      args: ['build'],
      exitCode: 1,
      stderr: 'Compilation error',
      cwd: tempDir
    });

    // Verify records exist in database
    const dbPath = path.join(ledgerDir, 'projection.db');
    assert.ok(fs.existsSync(dbPath));

    storage.close();

    // Wipe out projection completely
    try { fs.rmSync(dbPath, { force: true }); } catch {}
    assert.strictEqual(fs.existsSync(dbPath), false);

    // Need to re-init after deleting the db!
    storage.initDatabase();

    // Run rebuild
    const result = storage.rebuildProjections();

    assert.strictEqual(result.incidentsDerived, 2);
    
    // Verify records exist in database
    assert.ok(storage.getRecord('1'));
    assert.ok(storage.getRecord('2'));

    // Check that incident 1 state is correctly recovered with attempts and verification runs
    const restored1 = storage.getRecord('1');
    assert.strictEqual(restored1.status, 'RECOVERED');
    assert.strictEqual(restored1.recoveryAttempts.length, 1);
    assert.strictEqual(restored1.recoveryAttempts[0].status, 'VERIFIED');
    assert.strictEqual(restored1.recoveryAttempts[0].verificationRuns.length, 1);
    assert.strictEqual(restored1.recoveryAttempts[0].verificationRuns[0].result, 'PASSED');
  });

  it('leaves authoritative journal completely untouched during rebuild', () => {
    const storage = new StorageEngine(ledgerDir);
    storage.init();

    storage.saveRecord({ command: 'node', exitCode: 1, stderr: 'err', cwd: tempDir });

    const journalPath = path.join(ledgerDir, 'journal.jsonl');
    const beforeContent = fs.readFileSync(journalPath, 'utf8');
    const beforeStat = fs.statSync(journalPath);

    storage.rebuildProjections();

    const afterContent = fs.readFileSync(journalPath, 'utf8');
    const afterStat = fs.statSync(journalPath);

    assert.strictEqual(beforeContent, afterContent);
    assert.strictEqual(beforeStat.mtimeMs, afterStat.mtimeMs);
  });

  it('automatically triggers non-destructive rebuild when projection schema version is outdated or missing', async () => {
    const storage1 = new StorageEngine(ledgerDir);
    storage1.init();

    storage1.saveRecord({
      command: 'npm',
      args: ['test'],
      fullCommand: 'npm test',
      exitCode: 1,
      stderr: 'Test failed',
      cwd: tempDir
    });

    assert.strictEqual(storage1.getProjectionSchemaVersion(), 1);
    storage1.close();

    // Tamper with metadata table to simulate schema version drift (e.g. version 0)
    const dbPath = path.join(ledgerDir, 'projection.db');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE metadata SET value = '0' WHERE key = 'projectionSchemaVersion'").run();
    // Also alter records in SQLite to verify rebuild replaces them from journal
    db.prepare("UPDATE records SET data = '{\"corrupted\":true}'").run();
    db.close();

    // Now re-initialize StorageEngine
    const storage2 = new StorageEngine(ledgerDir);
    storage2.init();

    // Verify automatic rebuild occurred:
    // 1. projectionSchemaVersion updated back to current
    assert.strictEqual(storage2.getProjectionSchemaVersion(), 1);
    // 2. Incident record #1 restored cleanly from authoritative journal
    const restored = storage2.getRecord('1');
    assert.ok(restored);
    assert.strictEqual(restored.fullCommand, 'npm test');
    assert.strictEqual(restored.exitCode, 1);
    storage2.close();
  });
});
