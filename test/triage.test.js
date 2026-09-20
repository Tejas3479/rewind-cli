import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { StorageEngine } from '../src/storage/store.js';
import { IncidentStatus, RecoveryAttemptStatus, ProvenanceType, EvidenceQuality } from '../src/storage/state.js';
import {
  getTriageCandidateIncidents,
  formatReviewScreen,
  recordTriageRecovery,
  executeTriageVerification
} from '../src/triage/engine.js';
import { runCLI } from '../src/cli.js';
import { createStyler } from '../src/formatter.js';
import { stripAnsi } from '../src/sanitizer.js';

function createMockIO({ stdinLines = [], isTTY = true } = {}) {
  let stdoutData = '';
  let stderrData = '';
  const linesQueue = [...stdinLines];

  const stdin = new PassThrough();
  stdin.isTTY = isTTY;

  const stdout = new Writable({
    write(chunk, encoding, callback) {
      stdoutData += chunk.toString();
      callback();

      if (linesQueue.length > 0) {
        setImmediate(() => {
          if (linesQueue.length > 0) {
            const nextLine = linesQueue.shift();
            stdin.write(nextLine + '\n');
          }
        });
      }
    }
  });
  stdout.isTTY = isTTY;

  const stderr = new Writable({
    write(chunk, encoding, callback) {
      stderrData += chunk.toString();
      callback();
    }
  });
  stderr.isTTY = isTTY;

  return {
    stdin,
    stdout,
    stderr,
    getStdout: () => stdoutData,
    getStderr: () => stderrData
  };
}

describe('Interactive Recovery Triage Workflow (test/triage.test.js)', () => {
  let tempDir;
  let storage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-triage-test-'));
    storage = new StorageEngine(path.join(tempDir, '.rewind'));
    storage.init();
  });

  afterEach(() => {
    try {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    } catch {
      // Ignore
    }
  });

  describe('Non-Interactive Terminal Guard', () => {
    test('rejects triage when terminal is non-interactive (!isTTY) with actionable message', async () => {
      const { stdin, stdout, stderr, getStdout } = createMockIO({ isTTY: false });

      const exitCode = await runCLI(['triage', '--root', tempDir], {
        stdin,
        stdout,
        stderr,
        isTTY: false
      });

      assert.equal(exitCode, 1);
      const out = getStdout();
      assert.match(out, /This command requires an interactive terminal\. Use the non-interactive recovery command instead\./);
    });
  });

  describe('Empty History & Invalid ID Handling', () => {
    test('handles empty ledger history gracefully', async () => {
      const { stdin, stdout, stderr, getStdout } = createMockIO({ isTTY: true });

      const exitCode = await runCLI(['triage', '--root', tempDir], {
        stdin,
        stdout,
        stderr,
        isTTY: true
      });

      assert.equal(exitCode, 0);
      const out = getStdout();
      assert.match(out, /No recorded incidents found in the ledger/);
    });

    test('rejects unknown incident ID with ERR_NOT_FOUND', async () => {
      const { stdin, stdout, stderr, getStderr } = createMockIO({ isTTY: true });

      const exitCode = await runCLI(['triage', '999', '--root', tempDir], {
        stdin,
        stdout,
        stderr,
        isTTY: true
      });

      assert.equal(exitCode, 1);
      const errOut = getStderr();
      assert.match(errOut, /Incident #999 not found in ledger/);
    });
  });

  describe('Triage Engine State Machine & Evidentiary Invariants', () => {
    test('candidate selection prioritizes unrecovered incidents', () => {
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 50,
        stderr: 'Error 1',
        cwd: tempDir
      });

      storage.saveRecord({
        command: 'cargo',
        args: ['build'],
        fullCommand: 'cargo build',
        exitCode: 101,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 80,
        stderr: 'Error 2',
        cwd: tempDir
      });

      const candidates = getTriageCandidateIncidents(storage);
      assert.equal(candidates.all.length, 2);
      assert.equal(candidates.unrecovered.length, 2);
    });

    test('recordTriageRecovery creates attempt in FIXED (unverified) state without promoting incident to RECOVERED', () => {
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 100,
        stderr: 'TypeError: undefined is not a function',
        cwd: tempDir
      });

      const { updatedRecord, attempt } = recordTriageRecovery(storage, {
        incidentId: '1',
        cause: 'Null check missing in handler',
        change: 'Added optional chaining operator',
        verifyCmd: 'npm test',
        observedChanges: { files: ['src/handler.js'], provenance: ProvenanceType.AUTOMATICALLY_OBSERVED }
      });

      assert.equal(updatedRecord.status, IncidentStatus.OPEN); // Must remain OPEN
      assert.notEqual(updatedRecord.status, IncidentStatus.RECOVERED);
      assert.equal(attempt.status, RecoveryAttemptStatus.FIXED);
      assert.equal(attempt.evidenceQuality, EvidenceQuality.UNVERIFIED);
      assert.equal(attempt.causeProvenance, ProvenanceType.USER_REPORTED);
      assert.equal(attempt.changeProvenance, ProvenanceType.USER_REPORTED);
      assert.deepEqual(attempt.observedChanges.files, ['src/handler.js']);
    });

    test('executeTriageVerification promotes to RECOVERED on exit 0', async () => {
      storage.saveRecord({
        command: 'node',
        args: ['app.js'],
        fullCommand: 'node app.js',
        exitCode: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 40,
        stderr: 'ECONNREFUSED',
        cwd: tempDir
      });

      const { attempt } = recordTriageRecovery(storage, {
        incidentId: '1',
        cause: 'Service down',
        change: 'Started service',
        verifyCmd: 'node -e "process.exit(0);"'
      });

      const mockContext = {
        storage,
        config: { rootDir: tempDir },
        env: process.env,
        stdout: null,
        stderr: null
      };

      const result = await executeTriageVerification({
        context: mockContext,
        incidentId: '1',
        attemptId: attempt.id,
        verifyCmd: 'node -e "process.exit(0);"'
      });

      assert.equal(result.success, true);
      assert.equal(result.exitCode, 0);
      assert.equal(result.updatedRecord.status, IncidentStatus.RECOVERED);
      assert.equal(result.updatedRecord.recoveryAttempts[0].status, RecoveryAttemptStatus.VERIFIED);
      assert.equal(result.updatedRecord.recoveryAttempts[0].evidenceQuality, EvidenceQuality.DIRECT);
    });

    test('executeTriageVerification seals failed attempt in negative memory on non-zero exit', async () => {
      storage.saveRecord({
        command: 'node',
        args: ['app.js'],
        fullCommand: 'node app.js',
        exitCode: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 40,
        stderr: 'ECONNREFUSED',
        cwd: tempDir
      });

      const { attempt } = recordTriageRecovery(storage, {
        incidentId: '1',
        cause: 'Wrong port hypothesis',
        change: 'Tried changing port to 9000',
        verifyCmd: 'node -e "console.error(\'Port 9000 also closed\'); process.exit(1);"'
      });

      const mockContext = {
        storage,
        config: { rootDir: tempDir },
        env: process.env,
        stdout: null,
        stderr: null
      };

      const result = await executeTriageVerification({
        context: mockContext,
        incidentId: '1',
        attemptId: attempt.id,
        verifyCmd: 'node -e "console.error(\'Port 9000 also closed\'); process.exit(1);"'
      });

      assert.equal(result.success, false);
      assert.equal(result.exitCode, 1);
      assert.equal(result.updatedRecord.status, IncidentStatus.OPEN); // Incident stays OPEN
      assert.equal(result.updatedRecord.recoveryAttempts[0].status, RecoveryAttemptStatus.FAILED);
      assert.equal(result.updatedRecord.recoveryAttempts[0].verificationRuns[0].result, 'FAILED');
    });
  });

  describe('End-to-End Interactive CLI Simulation', () => {
    test('full flow: select incident -> record recovery -> confirm verification -> VERIFIED', async () => {
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 120,
        stderr: 'ReferenceError: config is not defined\n    at index.js:10:5',
        cwd: tempDir
      });

      const stdinLines = [
        'Missing config object import',
        'Imported config from ./config.js',
        'node -e "console.log(\'Tests passed\'); process.exit(0);"',
        'y'
      ];

      const { stdin, stdout, stderr, getStdout } = createMockIO({ stdinLines, isTTY: true });

      const exitCode = await runCLI(['triage', '1', '--root', tempDir], {
        stdin,
        stdout,
        stderr,
        isTTY: true
      });

      assert.equal(exitCode, 0);
      const out = stripAnsi(getStdout());

      // Check review screen and recovery recorded
      assert.match(out, /RECOVERY REVIEW/);
      assert.match(out, /FIXED — NOT YET VERIFIED/);
      assert.match(out, /RECOVERY RECORDED/);
      assert.match(out, /\[USER CLAIM\] Cause:/);
      assert.match(out, /\[USER CLAIM\] Fix:/);

      // Check verified output
      assert.match(out, /VERIFIED!/);
      assert.match(out, /✓ RECOVERY VERIFIED/);
      assert.match(out, /The verified recovery has been sealed into the ledger\./);

      storage.rebuildIndex();
      const record = storage.getRecord('1');
      assert.equal(record.status, IncidentStatus.RECOVERED);
      assert.equal(record.recoveryAttempts[0].status, RecoveryAttemptStatus.VERIFIED);
    });

    test('verification failure flow: confirms verification -> fails -> marks FAILED in negative memory', async () => {
      storage.saveRecord({
        command: 'pytest',
        args: ['test_api.py'],
        fullCommand: 'pytest test_api.py',
        exitCode: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 200,
        stderr: 'FAILED test_api.py::test_login - AssertionError',
        cwd: tempDir
      });

      const stdinLines = [
        'Session cookie expiration misconfigured',
        'Increased token lifetime',
        'node -e "console.error(\'AssertionError: still failed\'); process.exit(1);"',
        'y'
      ];

      const { stdin, stdout, stderr, getStdout } = createMockIO({ stdinLines, isTTY: true });

      const exitCode = await runCLI(['triage', '1', '--root', tempDir], {
        stdin,
        stdout,
        stderr,
        isTTY: true
      });

      assert.equal(exitCode, 1);
      const out = stripAnsi(getStdout());

      assert.match(out, /RECOVERY RECORDED/);
      assert.match(out, /NOT VERIFIED:/);
      assert.match(out, /VERIFICATION FAILED \(Preserved in Negative Memory\)/);
      assert.match(out, /permanently sealed into negative memory/);

      storage.rebuildIndex();
      const record = storage.getRecord('1');
      assert.equal(record.status, IncidentStatus.OPEN);
      assert.equal(record.recoveryAttempts[0].status, RecoveryAttemptStatus.FAILED);
    });

    test('verification rejection flow: user answers "n" to runNow -> keeps FIXED (unverified)', async () => {
      storage.saveRecord({
        command: 'cargo',
        args: ['test'],
        fullCommand: 'cargo test',
        exitCode: 101,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 300,
        stderr: 'error[E0425]: cannot find value `foo` in this scope',
        cwd: tempDir
      });

      const stdinLines = [
        'Missing variable declaration',
        'Declared let foo = 42;',
        'cargo test',
        'n' // Skip verification execution
      ];

      const { stdin, stdout, stderr, getStdout } = createMockIO({ stdinLines, isTTY: true });

      const exitCode = await runCLI(['triage', '1', '--root', tempDir], {
        stdin,
        stdout,
        stderr,
        isTTY: true
      });

      assert.equal(exitCode, 0);
      const out = stripAnsi(getStdout());

      assert.match(out, /RECOVERY RECORDED/);
      assert.match(out, /Verification skipped/);
      assert.match(out, /OPEN \(FIXED — NOT YET VERIFIED\)/);
      assert.match(out, /To verify later, run: "rewind verify 1"/);

      storage.rebuildIndex();
      const record = storage.getRecord('1');
      assert.equal(record.status, IncidentStatus.OPEN);
      assert.equal(record.recoveryAttempts[0].status, RecoveryAttemptStatus.FIXED);
      assert.equal(record.recoveryAttempts[0].evidenceQuality, EvidenceQuality.UNVERIFIED);
    });

    test('aborts cleanly when user enters no recovery details', async () => {
      storage.saveRecord({
        command: 'npm',
        args: ['run', 'build'],
        fullCommand: 'npm run build',
        exitCode: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 50,
        stderr: 'Build failed',
        cwd: tempDir
      });

      const stdinLines = [
        '', // empty cause
        '', // empty change
        ''  // empty verifyCmd
      ];

      const { stdin, stdout, stderr, getStdout } = createMockIO({ stdinLines, isTTY: true });

      const exitCode = await runCLI(['triage', '1', '--root', tempDir], {
        stdin,
        stdout,
        stderr,
        isTTY: true
      });

      assert.equal(exitCode, 0);
      const out = stripAnsi(getStdout());
      assert.match(out, /No recovery details entered\. Triage aborted\./);

      storage.rebuildIndex();
      const record = storage.getRecord('1');
      assert.equal(record.recoveryAttempts.length, 0);
    });

    test('repeated triage attempts preserve complete history across iterations', async () => {
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 60,
        stderr: 'DB Connection Error',
        cwd: tempDir
      });

      // Attempt 1: Fails
      {
        const stdinLines = [
          'Wrong timeout hypothesis',
          'Increased timeout',
          'node -e "process.exit(1);"',
          'y'
        ];
        const { stdin, stdout, stderr } = createMockIO({ stdinLines, isTTY: true });
        await runCLI(['triage', '1', '--root', tempDir], { stdin, stdout, stderr, isTTY: true });
      }

      // Attempt 2: Succeeds
      {
        const stdinLines = [
          'Database container was stopped',
          'Started database container',
          'node -e "process.exit(0);"',
          'y'
        ];
        const { stdin, stdout, stderr } = createMockIO({ stdinLines, isTTY: true });
        const exitCode = await runCLI(['triage', '1', '--root', tempDir], { stdin, stdout, stderr, isTTY: true });
        assert.equal(exitCode, 0);
      }

      storage.rebuildIndex();
      const record = storage.getRecord('1');
      assert.equal(record.status, IncidentStatus.RECOVERED);
      assert.equal(record.recoveryAttempts.length, 2);
      assert.equal(record.recoveryAttempts[0].id, 1);
      assert.equal(record.recoveryAttempts[0].status, RecoveryAttemptStatus.FAILED);
      assert.equal(record.recoveryAttempts[1].id, 2);
      assert.equal(record.recoveryAttempts[1].status, RecoveryAttemptStatus.VERIFIED);
    });
  });

  describe('NO_COLOR Compatibility', () => {
    test('formatReviewScreen produces clean text without ANSI escapes when styled with no color', () => {
      const s = createStyler(false);
      const reviewBox = formatReviewScreen({
        cause: 'Database disconnected',
        change: 'Reconnected database',
        verifyCmd: 'npm test'
      }, s);

      assert.doesNotMatch(reviewBox, /\x1b\[[0-9;]*m/);
      assert.match(reviewBox, /RECOVERY REVIEW/);
      assert.match(reviewBox, /CAUSE/);
      assert.match(reviewBox, /CHANGE/);
      assert.match(reviewBox, /VERIFY/);
      assert.match(reviewBox, /STATUS/);
    });
  });
});

