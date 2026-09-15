import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { StorageEngine, normalizeId } from '../src/storage/store.js';
import { computeFingerprint } from '../src/storage/fingerprint.js';
import { isValidRecord } from '../src/storage/record.js';
import { IncidentStatus, RecoveryAttemptStatus } from '../src/storage/state.js';

function createMockCapture(overrides = {}) {
  return {
    command: 'npm',
    args: ['test'],
    fullCommand: 'npm test',
    cwd: '/mock/project',
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    durationMs: 150,
    exitCode: 1,
    signal: null,
    success: false,
    stdout: '',
    stderr: 'AssertionError: fail',
    stdoutRaw: '',
    stderrRaw: 'AssertionError: fail\n',
    git: {
      isGit: true,
      gitDir: '/mock/.git',
      headCommit: '1234567890123456789012345678901234567890',
      ref: 'refs/heads/main',
      branch: 'main',
      detached: false,
      workingTreeState: 'unverified'
    },
    environment: {
      platform: 'linux',
      arch: 'x64',
      osRelease: '6.5.0',
      nodeVersion: 'v22.0.0',
      totalEnvVars: 10,
      envKeys: ['PATH', 'NODE_ENV'],
      safeValues: { NODE_ENV: 'test' }
    },
    ...overrides
  };
}

describe('Persistent Local Event Storage (src/storage/store.js)', () => {
  test('initializes storage directory layout in target folder', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-store-test-'));
    try {
      const store = new StorageEngine(path.join(tmpDir, '.rewind'));
      store.init();

      assert.ok(fs.existsSync(store.ledgerDir));
      assert.ok(fs.existsSync(store.dbPath));
      assert.ok(fs.existsSync(store.tmpDir));
      assert.ok(fs.existsSync(store.quarantineDir));
      store.close();
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('writes a record atomically and reads it back by ID', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-store-test-'));
    try {
      const store = new StorageEngine(path.join(tmpDir, '.rewind')).init();
      const capture = createMockCapture({ stderr: 'Database connection failed' });

      const saved = store.saveRecord(capture);
      assert.equal(saved.id, '1');
      assert.equal(saved.status, IncidentStatus.OBSERVED);
      assert.ok(saved.fingerprint);

      // Verify record exists in SQLite
      const rows = store.db.prepare('SELECT * FROM records WHERE id = ?').all('1');
      assert.equal(rows.length, 1);
      const diskContent = JSON.parse(rows[0].data);
      assert.equal(diskContent.id, '1');
      assert.equal(diskContent.stderr, 'Database connection failed');

      // Verify in-memory getRecord
      const fetched = store.getRecord('1');
      assert.deepEqual(fetched, saved);
      store.close();
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('restarting StorageEngine rebuilds in-memory index from disk', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-store-test-'));
    try {
      const ledgerPath = path.join(tmpDir, '.rewind');

      // First run: save 3 records
      const store1 = new StorageEngine(ledgerPath).init();
      store1.saveRecord(createMockCapture({ stderr: 'Error 1' }));
      store1.saveRecord(createMockCapture({ stderr: 'Error 2' }));
      store1.saveRecord(createMockCapture({ stderr: 'Error 3' }));
      assert.equal(store1.listRecords().total, 3);
      store1.close();

      // Second run: simulate new process startup
      const store2 = new StorageEngine(ledgerPath).init();
      assert.equal(store2.listRecords().total, 3);
      assert.equal(store2.getRecord('1')?.stderr, 'Error 1');
      assert.equal(store2.getRecord('2')?.stderr, 'Error 2');
      assert.equal(store2.getRecord('3')?.stderr, 'Error 3');
      assert.equal(store2.getNextId(), '4');
      store2.close();
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('cleans orphaned .tmp files on startup', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-store-test-'));
    try {
      const ledgerPath = path.join(tmpDir, '.rewind');
      const store = new StorageEngine(ledgerPath);
      fs.mkdirSync(store.tmpDir, { recursive: true });

      // Create fake orphaned temp file
      const orphanPath = path.join(store.tmpDir, 'abandoned_write_123.tmp');
      fs.writeFileSync(orphanPath, 'partial write...');
      assert.ok(fs.existsSync(orphanPath));

      store.init();
      // Orphaned temp file should be removed
      assert.equal(fs.existsSync(orphanPath), false);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('quarantines malformed/corrupted JSON records without crashing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-store-test-'));
    try {
      const ledgerPath = path.join(tmpDir, '.rewind');
      const store1 = new StorageEngine(ledgerPath).init();
      store1.saveRecord(createMockCapture({ stderr: 'Good record 1' }));
      store1.saveRecord(createMockCapture({ stderr: 'Corrupt me' }));
      store1.saveRecord(createMockCapture({ stderr: 'Good record 3' }));

      // Corrupt record 2 in SQLite
      store1.db.exec(`UPDATE records SET data = '{"broken json: true, oops...' WHERE id = '2'`);
      store1.close();

      // Restart store (simulate new invocation)
      const store2 = new StorageEngine(ledgerPath).init();

      // Tool should NOT crash and should load healthy records (1 and 3)
      const { records } = store2.listRecords();
      assert.equal(records.length, 2);
      assert.equal(records[0].id, '1');
      assert.equal(records[1].id, '3');

      store2.close();
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('quarantines records failing schema validation', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-store-test-'));
    try {
      const ledgerPath = path.join(tmpDir, '.rewind');
      const store = new StorageEngine(ledgerPath);
      fs.mkdirSync(store.recordsDir, { recursive: true });

      // Write valid JSON that lacks required schema fields
      fs.writeFileSync(path.join(store.recordsDir, 'invalid_schema.json'), JSON.stringify({ foo: 'bar' }));

      store.init();

      assert.equal(store.listRecords().total, 0);
      assert.equal(store.getQuarantined().length, 1);
      assert.ok(store.getQuarantined()[0].reason.includes('Schema validation failed'));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('handles realistic large record set (50+ records) with proper ordering', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-store-test-'));
    try {
      const ledgerPath = path.join(tmpDir, '.rewind');
      const store = new StorageEngine(ledgerPath).init();

      for (let i = 1; i <= 55; i++) {
        store.saveRecord(createMockCapture({
          command: `cmd-${i}`,
          exitCode: i,
          stderr: `Failure number ${i}`
        }));
      }

      const { records: all } = store.listRecords();
      assert.equal(all.length, 55);
      assert.equal(all[0].id, '1');
      assert.equal(all[54].id, '55');
      assert.equal(store.getNextId(), '56');

      // Verify reload
      const store2 = new StorageEngine(ledgerPath).init();
      assert.equal(store2.listRecords().total, 55);
      assert.equal(store2.getRecord('42')?.command, 'cmd-42');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('computeFingerprint generates consistent deterministic hashes', () => {
    const f1 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'Error: Cannot find module "foo"'
    });

    const f2 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'Error: Cannot find module "foo"'
    });

    assert.equal(f1.fingerprint, f2.fingerprint);
    assert.equal(f1.fingerprint.length, 16);

    const f3 = computeFingerprint({
      command: 'pytest',
      args: ['tests/'],
      exitCode: 2,
      stderr: 'Failing test in test_auth.py'
    });

    assert.notEqual(f1.fingerprint, f3.fingerprint);
  });

  test('readLastJournalEvent accurately parses tail event and handles whitespace/trailing newlines', async () => {
    const { readLastJournalEvent, appendJournalEvent } = await import('../src/storage/journal.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-tail-test-'));
    try {
      const journalPath = path.join(tmpDir, 'journal.jsonl');

      // 1. Non-existent file returns null
      assert.equal(readLastJournalEvent(journalPath), null);

      // 2. Empty file returns null
      fs.writeFileSync(journalPath, '', 'utf8');
      assert.equal(readLastJournalEvent(journalPath), null);

      // 3. File with whitespace lines returns null
      fs.writeFileSync(journalPath, '\n   \n\t\n', 'utf8');
      assert.equal(readLastJournalEvent(journalPath), null);

      // 4. Append 3 events
      appendJournalEvent(tmpDir, { type: 'failure.observed', incidentId: '1', payload: { command: 'cmd1' } });
      appendJournalEvent(tmpDir, { type: 'failure.observed', incidentId: '2', payload: { command: 'cmd2' } });
      const ev3 = appendJournalEvent(tmpDir, { type: 'failure.observed', incidentId: '3', payload: { command: 'cmd3' } });

      const last = readLastJournalEvent(journalPath);
      assert.ok(last);
      assert.equal(last.sequence, 3);
      assert.equal(last.incidentId, '3');
      assert.equal(last.chainHash, ev3.chainHash);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('fast-path init loads from records dir when checkpoint matches journal tail and falls back on drift', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-fastpath-test-'));
    try {
      const ledgerPath = path.join(tmpDir, '.rewind');
      const store = new StorageEngine(ledgerPath).init();

      // Save 3 incidents
      store.saveRecord(createMockCapture({ stderr: 'Error 1' }));
      store.saveRecord(createMockCapture({ stderr: 'Error 2' }));
      store.saveRecord(createMockCapture({ stderr: 'Error 3' }));

      // Re-init with valid checkpoint -> should fast-load
      const storeFast = new StorageEngine(ledgerPath).init();
      assert.equal(storeFast.listRecords().total, 3);
      assert.equal(storeFast.getRecord('2')?.stderr, 'Error 2');

      // Delete checkpoint.json to simulate drift -> init should fallback to full rebuild cleanly
      const checkpointPath = path.join(ledgerPath, 'checkpoint.json');
      fs.unlinkSync(checkpointPath);

      const storeFallback = new StorageEngine(ledgerPath).init();
      assert.equal(storeFallback.listRecords().total, 3);
      assert.equal(storeFallback.getRecord('3')?.stderr, 'Error 3');

      // Verify checkpoint was regenerated by fallback rebuild
      assert.ok(fs.existsSync(checkpointPath));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
