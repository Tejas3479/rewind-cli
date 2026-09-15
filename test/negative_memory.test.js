import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StorageEngine } from '../src/storage/store.js';
import { extractNegativeMemory } from '../src/storage/negative_memory.js';

describe('Negative Memory Engine (src/storage/negative_memory.js)', () => {
  test('extracts and indexes failed recovery attempts across a failure fingerprint family', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-negmem-test-'));
    try {
      const storage = new StorageEngine(tmpDir).init();

      const incident = storage.saveRecord({
        command: 'cargo',
        args: ['build'],
        fullCommand: 'cargo build',
        cwd: tmpDir,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 100,
        exitCode: 101,
        signal: null,
        success: false,
        stdout: '',
        stderr: 'error[E0432]: unresolved import `tokio::runtime`',
        git: { isGit: false },
        environment: { platform: 'linux', nodeVersion: 'v22.0.0', nodeMajor: 22 }
      });

      // Add Attempt 1 (Fails)
      storage.addRecoveryAttempt(incident.id, {
        cause: 'Missing tokio feature flag',
        change: 'Added features = ["rt"] to Cargo.toml',
        verifyCmd: 'cargo check'
      });
      storage.recordVerificationRun(incident.id, 1, {
        command: 'cargo check',
        exitCode: 101,
        durationMs: 80,
        output: 'error[E0432]: unresolved import `tokio::runtime`'
      });

      // Add Attempt 2 (Fails)
      storage.addRecoveryAttempt(incident.id, {
        cause: 'Cargo cache corrupted',
        change: 'Ran cargo clean',
        verifyCmd: 'cargo check'
      });
      storage.recordVerificationRun(incident.id, 2, {
        command: 'cargo check',
        exitCode: 101,
        durationMs: 150,
        output: 'error[E0432]: still unresolved'
      });

      // Add Attempt 3 (Passes)
      storage.addRecoveryAttempt(incident.id, {
        cause: 'Full tokio feature needed',
        change: 'Added features = ["full"] in Cargo.toml',
        verifyCmd: 'cargo check'
      });
      storage.recordVerificationRun(incident.id, 3, {
        command: 'cargo check',
        exitCode: 0,
        durationMs: 90,
        output: 'Finished dev profile'
      });

      // Query Negative Memory for this fingerprint
      const failed = storage.getNegativeMemory(incident.fingerprint);

      assert.equal(failed.length, 2);
      assert.equal(failed[0].change, 'Ran cargo clean');
      assert.equal(failed[0].exitCode, 101);
      assert.equal(failed[1].change, 'Added features = ["rt"] to Cargo.toml');
      assert.equal(failed[1].exitCode, 101);

      // Verify that the verified attempt is NOT in negative memory
      const hasVerified = failed.some(f => f.change === 'Added features = ["full"] in Cargo.toml');
      assert.equal(hasVerified, false);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
