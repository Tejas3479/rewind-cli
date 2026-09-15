import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StorageEngine } from '../src/storage/store.js';
import { IncidentStatus, RecoveryAttemptStatus, ProvenanceType, EvidenceQuality } from '../src/storage/state.js';
import { extractNegativeMemory } from '../src/storage/negative_memory.js';
import { buildAgentContext } from '../src/storage/context.js';

describe('Recovery Provenance & Evidence Quality Layer (test/provenance.test.js)', () => {
  let tempDir;
  let storage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-provenance-test-'));
    storage = new StorageEngine(tempDir);
    storage.init();
  });

  afterEach(() => {
    try {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    } catch {
      // Ignore
    }
  });

  test('multi-attempt progression: preserves all historical attempts without overwriting', () => {
    // 1. Initial failure
    const rec = storage.saveRecord({
      command: 'npm',
      args: ['test'],
      fullCommand: 'npm test',
      cwd: tempDir,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 150,
      exitCode: 1,
      signal: null,
      success: false,
      stderr: 'Error: Database connection timeout'
    });

    assert.equal(rec.id, '1');
    assert.equal(rec.status, IncidentStatus.OBSERVED);
    assert.equal(rec.recoveryAttempts.length, 0);

    // 2. Attempt 1: User proposes increasing timeout
    storage.addRecoveryAttempt('1', {
      cause: 'Database pool initialization timeout',
      change: 'Increased connection timeout to 10s',
      verifyCmd: 'npm test'
    });

    let record = storage.getRecord('1');
    assert.equal(record.status, IncidentStatus.OPEN);
    assert.equal(record.recoveryAttempts.length, 1);
    assert.equal(record.recoveryAttempts[0].id, 1);
    assert.equal(record.recoveryAttempts[0].status, RecoveryAttemptStatus.PROPOSED);
    assert.equal(record.recoveryAttempts[0].causeProvenance, ProvenanceType.USER_REPORTED);
    assert.equal(record.recoveryAttempts[0].changeProvenance, ProvenanceType.USER_REPORTED);
    assert.equal(record.recoveryAttempts[0].evidenceQuality, EvidenceQuality.USER_REPORTED);

    // 3. Attempt 1 Verification Fails (exit 1)
    storage.recordVerificationRun('1', 1, {
      command: 'npm test',
      exitCode: 1,
      durationMs: 200,
      output: 'FAIL: Still timed out connecting to Postgres'
    });

    record = storage.getRecord('1');
    assert.equal(record.status, IncidentStatus.OPEN); // Stays OPEN
    assert.equal(record.recoveryAttempts.length, 1);
    assert.equal(record.recoveryAttempts[0].status, RecoveryAttemptStatus.FAILED);
    assert.equal(record.recoveryAttempts[0].verificationRuns.length, 1);
    assert.equal(record.recoveryAttempts[0].verificationRuns[0].result, 'FAILED');
    assert.equal(record.recoveryAttempts[0].verificationRuns[0].provenance, ProvenanceType.DIRECTLY_VERIFIED);

    // Verify Attempt 1 is in Negative Memory
    const failed = extractNegativeMemory([record]);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].attemptId, 1);
    assert.equal(failed[0].change, 'Increased connection timeout to 10s');

    // 4. Attempt 2: User identifies actual cause and fixes it
    storage.addRecoveryAttempt('1', {
      cause: 'Database service was not started on port 5432',
      change: 'Started local Postgres service on 5432',
      verifyCmd: 'npm test',
      isFixed: true
    });

    record = storage.getRecord('1');
    assert.equal(record.recoveryAttempts.length, 2);
    // Attempt 1 remains intact as FAILED
    assert.equal(record.recoveryAttempts[0].id, 1);
    assert.equal(record.recoveryAttempts[0].status, RecoveryAttemptStatus.FAILED);
    // Attempt 2 is FIXED (unverified)
    assert.equal(record.recoveryAttempts[1].id, 2);
    assert.equal(record.recoveryAttempts[1].status, RecoveryAttemptStatus.FIXED);
    assert.equal(record.recoveryAttempts[1].evidenceQuality, EvidenceQuality.UNVERIFIED);
    assert.equal(record.status, IncidentStatus.OPEN); // Not RECOVERED yet!

    // 5. Attempt 2 Verification Succeeds (exit 0)
    storage.recordVerificationRun('1', 2, {
      command: 'npm test',
      exitCode: 0,
      durationMs: 120,
      output: 'PASS: All 15 tests passed'
    });

    record = storage.getRecord('1');
    assert.equal(record.status, IncidentStatus.RECOVERED);
    assert.equal(record.recoveryAttempts.length, 2);
    assert.equal(record.recoveryAttempts[0].id, 1);
    assert.equal(record.recoveryAttempts[0].status, RecoveryAttemptStatus.FAILED);
    assert.equal(record.recoveryAttempts[1].id, 2);
    assert.equal(record.recoveryAttempts[1].status, RecoveryAttemptStatus.VERIFIED);
    assert.equal(record.recoveryAttempts[1].evidenceQuality, EvidenceQuality.DIRECT);
    assert.equal(record.recoveryAttempts[1].verificationRuns[0].provenance, ProvenanceType.DIRECTLY_VERIFIED);

    // Both attempts must still be present and ordered
    assert.equal(record.recoveryAttempts[0].change, 'Increased connection timeout to 10s');
    assert.equal(record.recoveryAttempts[1].change, 'Started local Postgres service on 5432');
  });

  test('USER_REPORTED != VERIFIED: user assertions never mark an incident as RECOVERED', () => {
    storage.saveRecord({
      command: 'cargo',
      args: ['build'],
      fullCommand: 'cargo build',
      cwd: tempDir,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 100,
      exitCode: 101,
      stderr: 'error[E0308]: mismatched types'
    });

    // User claims they fixed it
    storage.addRecoveryAttempt('1', {
      cause: 'Type mismatch in struct field',
      change: 'Changed u32 to u64',
      verifyCmd: 'cargo test'
    });

    const record = storage.getRecord('1');
    assert.notEqual(record.status, IncidentStatus.RECOVERED);
    assert.equal(record.status, IncidentStatus.OPEN);
    assert.equal(record.recoveryAttempts[0].causeProvenance, ProvenanceType.USER_REPORTED);
    assert.equal(record.recoveryAttempts[0].changeProvenance, ProvenanceType.USER_REPORTED);
  });

  test('FIXED != VERIFIED: marking attempt as FIXED keeps evidence quality UNVERIFIED until verification passes', () => {
    storage.saveRecord({
      command: 'python',
      args: ['app.py'],
      fullCommand: 'python app.py',
      cwd: tempDir,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 80,
      exitCode: 1,
      stderr: 'KeyError: "PORT"'
    });

    // Mark as FIXED via flag
    storage.addRecoveryAttempt('1', {
      cause: 'Missing PORT environment variable',
      change: 'Added PORT=8080 default in config.py',
      verifyCmd: 'python app.py',
      isFixed: true
    });

    let record = storage.getRecord('1');
    assert.equal(record.recoveryAttempts[0].status, RecoveryAttemptStatus.FIXED);
    assert.equal(record.recoveryAttempts[0].evidenceQuality, EvidenceQuality.UNVERIFIED);
    assert.equal(record.status, IncidentStatus.OPEN);

    // Verify context output also reflects UNVERIFIED
    const agentCtx = buildAgentContext(storage.ledgerDir, '1');
    assert.equal(agentCtx.observedEvidence.failure.status, IncidentStatus.OPEN);

    // Now execute verification with exit code 0
    storage.recordVerificationRun('1', 1, {
      command: 'python app.py',
      exitCode: 0,
      durationMs: 50,
      output: 'Server listening on port 8080'
    });

    record = storage.getRecord('1');
    assert.equal(record.status, IncidentStatus.RECOVERED);
    assert.equal(record.recoveryAttempts[0].status, RecoveryAttemptStatus.VERIFIED);
    assert.equal(record.recoveryAttempts[0].evidenceQuality, EvidenceQuality.DIRECT);
  });

  test('preserves observedChanges with AUTOMATICALLY_OBSERVED provenance without claiming causal proof', () => {
    storage.saveRecord({
      command: 'jest',
      args: ['auth.test.js'],
      fullCommand: 'jest auth.test.js',
      cwd: tempDir,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 250,
      exitCode: 1,
      stderr: 'FAIL: Expected 200 got 401'
    });

    const observedChanges = {
      files: ['src/auth/jwt.js', 'src/config.js'],
      count: 2,
      provenance: ProvenanceType.AUTOMATICALLY_OBSERVED
    };

    storage.addRecoveryAttempt('1', {
      cause: 'JWT expiration timestamp invalid',
      change: 'Adjusted expiration calculation',
      verifyCmd: 'jest auth.test.js',
      observedChanges
    });

    const record = storage.getRecord('1');
    assert.deepEqual(record.recoveryAttempts[0].observedChanges, observedChanges);
    assert.equal(record.recoveryAttempts[0].observedChanges.provenance, ProvenanceType.AUTOMATICALLY_OBSERVED);
  });

  test('replaying projections from journal preserves all provenance metadata across index rebuilds', () => {
    storage.saveRecord({
      command: 'npm',
      args: ['run', 'build'],
      fullCommand: 'npm run build',
      cwd: tempDir,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 300,
      exitCode: 1,
      stderr: 'SyntaxError: Unexpected token'
    });

    storage.addRecoveryAttempt('1', {
      cause: 'Missing closing brace',
      causeProvenance: ProvenanceType.USER_REPORTED,
      change: 'Added closing brace on line 42',
      changeProvenance: ProvenanceType.USER_REPORTED,
      verifyCmd: 'npm run build',
      isFixed: true
    });

    storage.recordVerificationRun('1', 1, {
      command: 'npm run build',
      exitCode: 0,
      durationMs: 150,
      output: 'Build successful'
    });

    // Rebuild in-memory index from scratch
    storage.rebuildIndex({ syncDisk: true });
    const reloaded = storage.getRecord('1');

    assert.equal(reloaded.status, IncidentStatus.RECOVERED);
    assert.equal(reloaded.recoveryAttempts[0].status, RecoveryAttemptStatus.VERIFIED);
    assert.equal(reloaded.recoveryAttempts[0].causeProvenance, ProvenanceType.USER_REPORTED);
    assert.equal(reloaded.recoveryAttempts[0].changeProvenance, ProvenanceType.USER_REPORTED);
    assert.equal(reloaded.recoveryAttempts[0].verificationRuns[0].provenance, ProvenanceType.DIRECTLY_VERIFIED);
  });
});
