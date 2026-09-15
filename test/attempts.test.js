import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StorageEngine } from '../src/storage/store.js';
import { IncidentStatus, RecoveryAttemptStatus } from '../src/storage/state.js';

describe('Multi-Attempt Recovery History (src/storage/store.js & record.js)', () => {
  test('records multiple sequential recovery attempts without overwriting history', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-attempts-test-'));
    try {
      const storage = new StorageEngine(tmpDir).init();

      // Create initial failure incident
      const incident = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        cwd: tmpDir,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 50,
        exitCode: 1,
        signal: null,
        success: false,
        stdout: '',
        stderr: 'FATAL: database port unreachable',
        git: { isGit: false },
        environment: { platform: 'win32', nodeVersion: 'v22.0.0', nodeMajor: 22 }
      });

      assert.equal(incident.status, IncidentStatus.OBSERVED);
      assert.equal(incident.recoveryAttempts.length, 0);

      // Attempt 1: Hypothesis A
      const updated1 = storage.addRecoveryAttempt(incident.id, {
        cause: 'Wrong port number in config',
        change: 'Changed port to 5432 in config.json',
        verifyCmd: 'node -e "process.exit(1);"' // Fails
      });

      assert.equal(updated1.status, IncidentStatus.OPEN);
      assert.equal(updated1.recoveryAttempts.length, 1);
      assert.equal(updated1.recoveryAttempts[0].id, 1);
      assert.equal(updated1.recoveryAttempts[0].status, RecoveryAttemptStatus.PROPOSED);

      // Execute Verification Run 1 (Fails)
      const afterRun1 = storage.recordVerificationRun(incident.id, 1, {
        command: 'node -e "process.exit(1);"',
        exitCode: 1,
        durationMs: 30,
        output: 'Port 5432 refused'
      });

      assert.equal(afterRun1.status, IncidentStatus.OPEN);
      assert.equal(afterRun1.recoveryAttempts[0].status, RecoveryAttemptStatus.FAILED);
      assert.equal(afterRun1.recoveryAttempts[0].verificationRuns.length, 1);
      assert.equal(afterRun1.recoveryAttempts[0].verificationRuns[0].result, 'FAILED');

      // Attempt 2: Hypothesis B
      const updated2 = storage.addRecoveryAttempt(incident.id, {
        cause: 'PostgreSQL container stopped',
        change: 'Started PostgreSQL docker container',
        verifyCmd: 'node -e "process.exit(0);"' // Passes
      });

      assert.equal(updated2.recoveryAttempts.length, 2);
      assert.equal(updated2.recoveryAttempts[0].id, 1);
      assert.equal(updated2.recoveryAttempts[0].status, RecoveryAttemptStatus.FAILED); // Preserved!
      assert.equal(updated2.recoveryAttempts[1].id, 2);
      assert.equal(updated2.recoveryAttempts[1].status, RecoveryAttemptStatus.PROPOSED);

      // Execute Verification Run 2 (Passes)
      const afterRun2 = storage.recordVerificationRun(incident.id, 2, {
        command: 'node -e "process.exit(0);"',
        exitCode: 0,
        durationMs: 40,
        output: 'Connected successfully'
      });

      assert.equal(afterRun2.status, IncidentStatus.RECOVERED);
      assert.equal(afterRun2.recoveryAttempts[1].status, RecoveryAttemptStatus.VERIFIED);
      assert.equal(afterRun2.recoveryAttempts[1].verificationRuns.length, 1);
      assert.equal(afterRun2.recoveryAttempts[1].verificationRuns[0].result, 'PASSED');

      // Verify persistent disk reload
      const reloadedStorage = new StorageEngine(tmpDir).init();
      const loaded = reloadedStorage.getRecord(incident.id);
      assert.equal(loaded.recoveryAttempts.length, 2);
      assert.equal(loaded.recoveryAttempts[0].status, RecoveryAttemptStatus.FAILED);
      assert.equal(loaded.recoveryAttempts[1].status, RecoveryAttemptStatus.VERIFIED);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
