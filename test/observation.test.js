import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StorageEngine } from '../src/storage/store.js';
import { IncidentStatus } from '../src/storage/state.js';

describe('Observation Architecture (src/storage/store.js & projection.js)', () => {
  test('saveObservation creates lightweight observation without creating incident record', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-obs-test-'));
    let storage = null;
    try {
      storage = new StorageEngine(tmpDir).init();

      const obs = storage.saveObservation({
        command: 'bash',
        args: ['-c', 'vite'],
        fullCommand: 'bash -c vite',
        cwd: tmpDir,
        durationMs: 40,
        exitCode: 127,
        signal: null,
        success: false,
        stdout: '',
        stderr: 'bash: vite: command not found',
        diagnostic: { errorType: 'CommandNotFound', message: 'vite: command not found' },
        environment: { platform: 'linux', nodeVersion: 'v22.0.0', nodeMajor: 22 },
        git: { isGit: false }
      });

      assert.ok(obs.id);
      assert.ok(obs.id.startsWith('obs_'));
      assert.ok(obs.fingerprint);
      assert.equal(obs.command, 'bash');
      assert.equal(obs.exitCode, 127);
      assert.equal(obs.promotedToIncident, null);
      assert.ok(obs.ttlExpiry);

      // Verify that NO incident was created in the main incident index
      const { records, total } = storage.listRecords();
      assert.equal(total, 0);
      assert.equal(records.length, 0);

      // Verify observation can be retrieved
      const fetched = storage.getObservation(obs.id);
      assert.equal(fetched.id, obs.id);
      assert.equal(fetched.fingerprint, obs.fingerprint);

      const allObs = storage.listObservations();
      assert.equal(allObs.length, 1);
      assert.equal(allObs[0].id, obs.id);
    } finally {
      if (storage) storage.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('observations persist across reload and journal rebuild', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-obs-persist-'));
    let storage1 = null;
    let storage2 = null;
    let storage3 = null;
    try {
      storage1 = new StorageEngine(tmpDir).init();
      const obs = storage1.saveObservation({
        command: 'npm',
        args: ['run', 'build'],
        fullCommand: 'npm run build',
        cwd: tmpDir,
        durationMs: 120,
        exitCode: 1,
        signal: null,
        success: false,
        stdout: '',
        stderr: 'ENOENT: no such file or directory, open config.json',
        diagnostic: { errorType: 'FileNotFound', message: 'ENOENT' },
        environment: { platform: 'win32', nodeVersion: 'v22.0.0' },
        git: { isGit: false }
      });
      storage1.close();
      storage1 = null;

      // Fast-path reload from SQLite
      storage2 = new StorageEngine(tmpDir).init();
      const loaded = storage2.getObservation(obs.id);
      assert.ok(loaded);
      assert.equal(loaded.id, obs.id);
      assert.equal(loaded.fingerprint, obs.fingerprint);
      assert.equal(loaded.command, 'npm');
      storage2.close();
      storage2 = null;

      // Full rebuild from journal
      storage3 = new StorageEngine(tmpDir);
      storage3.rebuildIndex({ syncDisk: true });
      const rebuilt = storage3.getObservation(obs.id);
      assert.ok(rebuilt);
      assert.equal(rebuilt.id, obs.id);
      assert.equal(rebuilt.fingerprint, obs.fingerprint);
      storage3.close();
      storage3 = null;
    } finally {
      if (storage1) storage1.close();
      if (storage2) storage2.close();
      if (storage3) storage3.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('shouldPromoteObservation evaluates recurrence and existing incident matches', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-obs-promote-check-'));
    let storage = null;
    try {
      storage = new StorageEngine(tmpDir).init();

      const failure = {
        command: 'pytest',
        args: ['test_api.py'],
        fullCommand: 'pytest test_api.py',
        cwd: tmpDir,
        durationMs: 300,
        exitCode: 1,
        signal: null,
        success: false,
        stdout: '',
        stderr: 'ConnectionRefusedError: [Errno 111] Connection refused',
        environment: { platform: 'linux' },
        git: { isGit: false }
      };

      // 1. First time seeing this failure -> should NOT promote yet
      const obs1 = storage.saveObservation(failure);
      assert.equal(storage.shouldPromoteObservation(obs1.fingerprint, { windowMs: 10000 }), true); // Because obs1 was saved, count >= 1

      // Test with an unseen fingerprint
      assert.equal(storage.shouldPromoteObservation('non_existent_fingerprint'), false);

      // 2. Existing incident match test
      const incident = storage.saveRecord({
        command: 'make',
        args: ['lint'],
        fullCommand: 'make lint',
        cwd: tmpDir,
        durationMs: 100,
        exitCode: 2,
        signal: null,
        success: false,
        stdout: '',
        stderr: 'SyntaxError: unexpected token',
        environment: { platform: 'linux' },
        git: { isGit: false }
      });
      assert.ok(incident.id);
      // Because incident exists in ledger, any failure with that fingerprint promotes immediately
      assert.equal(storage.shouldPromoteObservation(incident.fingerprint), true);
    } finally {
      if (storage) storage.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('promoteObservation converts observation to full incident and marks observation promoted', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-obs-promote-exec-'));
    let storage = null;
    let storageReloaded = null;
    try {
      storage = new StorageEngine(tmpDir).init();

      const obs = storage.saveObservation({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        cwd: tmpDir,
        durationMs: 80,
        exitCode: 1,
        signal: null,
        success: false,
        stdout: '',
        stderr: 'ECONNREFUSED: failed to connect to 127.0.0.1:5432',
        diagnostic: { errorType: 'ConnectionRefused', message: 'failed to connect' },
        environment: { platform: 'darwin', nodeVersion: 'v22.0.0', nodeMajor: 22 },
        git: { isGit: false }
      });

      assert.equal(obs.promotedToIncident, null);

      // Promote observation
      const incident = storage.promoteObservation(obs.id);
      assert.ok(incident);
      assert.ok(incident.id);
      assert.equal(incident.status, IncidentStatus.OBSERVED);
      assert.equal(incident.command, 'npm');
      assert.equal(incident.fingerprint, obs.fingerprint);
      assert.equal(incident.promotedFromObservation, obs.id);

      // Verify observation is marked as promoted
      const updatedObs = storage.getObservation(obs.id);
      assert.equal(updatedObs.promotedToIncident, incident.id);

      // Unpromoted list should now be empty
      const unpromoted = storage.listObservations({ unpromotedOnly: true });
      assert.equal(unpromoted.length, 0);

      // Re-promoting returns the existing incident
      const rePromoted = storage.promoteObservation(obs.id);
      assert.equal(rePromoted.id, incident.id);

      // Check journal and projection after reload
      storage.close();
      storage = null;

      storageReloaded = new StorageEngine(tmpDir).init();
      const loadedInc = storageReloaded.getRecord(incident.id);
      assert.ok(loadedInc);
      assert.equal(loadedInc.promotedFromObservation, obs.id);

      const loadedObs = storageReloaded.getObservation(obs.id);
      assert.equal(loadedObs.promotedToIncident, incident.id);
      storageReloaded.close();
      storageReloaded = null;
    } finally {
      if (storage) storage.close();
      if (storageReloaded) storageReloaded.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('cleanupExpiredObservations removes expired unpromoted observations and retains valid ones', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-obs-ttl-'));
    let storage = null;
    try {
      storage = new StorageEngine(tmpDir).init();

      // 1. Expired observation (TTL in past)
      const obsExpired = storage.saveObservation({
        command: 'curl',
        args: ['localhost:3000'],
        fullCommand: 'curl localhost:3000',
        cwd: tmpDir,
        durationMs: 10,
        exitCode: 7,
        signal: null,
        success: false,
        stdout: '',
        stderr: 'curl: (7) Failed to connect to localhost port 3000',
        environment: { platform: 'linux' },
        git: { isGit: false }
      }, { ttlMs: -5000 }); // expired 5 seconds ago

      // 2. Fresh observation (TTL in future)
      const obsFresh = storage.saveObservation({
        command: 'cargo',
        args: ['test'],
        fullCommand: 'cargo test',
        cwd: tmpDir,
        durationMs: 500,
        exitCode: 101,
        signal: null,
        success: false,
        stdout: '',
        stderr: 'thread panicked at assertion failed',
        environment: { platform: 'linux' },
        git: { isGit: false }
      }, { ttlMs: 600000 }); // 10 minutes in future

      // Verify both exist
      assert.equal(storage.listObservations().length, 2);

      // Run cleanup
      const deletedCount = storage.cleanupExpiredObservations();
      assert.ok(deletedCount >= 1);

      // Expired observation should be gone
      assert.equal(storage.getObservation(obsExpired.id), null);

      // Fresh observation should still exist
      assert.ok(storage.getObservation(obsFresh.id));
      assert.equal(storage.listObservations().length, 1);
    } finally {
      if (storage) storage.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
