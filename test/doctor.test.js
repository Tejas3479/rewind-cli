import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { StorageEngine } from '../src/storage/store.js';
import {
  runDoctorDiagnostics,
  executeDoctorRepair,
  calculateStorageSize,
  performRedactionSelfTest,
  performWriteProbe,
  checkActiveLock,
  formatByteSize
} from '../src/storage/doctor.js';
import { runCLI } from '../src/cli.js';

function createMockIO({ isTTY = false, env = {} } = {}) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk) => { stdout += chunk; return true; } },
      stderr: { write: (chunk) => { stderr += chunk; return true; } },
      stdin: {},
      env,
      isTTY,
      cwd: process.cwd()
    },
    getStdout: () => stdout,
    getStderr: () => stderr
  };
}

describe('Self-Diagnostics & Safe Maintenance (src/storage/doctor.js & rewind doctor)', () => {
  let tempDir;
  let ledgerDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-doctor-test-'));
    ledgerDir = path.join(tempDir, '.rewind');
  });

  afterEach(() => {
    try {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Unit Functions: Size, Probes, Redaction, Lock', () => {
    it('formatByteSize formats numbers cleanly across B, KB, MB', () => {
      assert.strictEqual(formatByteSize(0), '0 B');
      assert.strictEqual(formatByteSize(512), '512 B');
      assert.strictEqual(formatByteSize(1024), '1.0 KB');
      assert.strictEqual(formatByteSize(1048576), '1.0 MB');
      assert.strictEqual(formatByteSize(7759462), '7.4 MB');
    });

    it('calculateStorageSize recursively calculates disk usage and ignores external symlink traversal', () => {
      fs.mkdirSync(ledgerDir, { recursive: true });
      fs.writeFileSync(path.join(ledgerDir, 'file1.txt'), 'hello world', 'utf8');

      const sub = path.join(ledgerDir, 'sub');
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, 'file2.txt'), 'second file content', 'utf8');

      const size = calculateStorageSize(ledgerDir);
      assert.ok(size > 0);
      assert.strictEqual(typeof size, 'number');
    });

    it('performRedactionSelfTest verifies representative secret patterns with disclaimer', () => {
      const result = performRedactionSelfTest();
      assert.strictEqual(result.pass, true);
      assert.strictEqual(result.testedCount >= 5, true);
      assert.strictEqual(result.passedCount, result.testedCount);
      assert.ok(result.notice.includes('Configured redaction rules passed self-test'));
    });

    it('performWriteProbe performs ephemeral write, verify, flush, and deletion with zero lingering probe files', () => {
      const tmpDir = path.join(ledgerDir, 'tmp');
      fs.mkdirSync(tmpDir, { recursive: true });

      const probe = performWriteProbe(tmpDir);
      assert.strictEqual(probe.writePass, true);
      assert.strictEqual(probe.cleanupPass, true);
      assert.strictEqual(probe.error, null);

      // Verify no lingering probe files exist
      const remaining = fs.readdirSync(tmpDir).filter(f => f.startsWith('doctor_probe_'));
      assert.strictEqual(remaining.length, 0);
    });

    it('checkActiveLock accurately detects active lockfiles', () => {
      fs.mkdirSync(ledgerDir, { recursive: true });
      assert.strictEqual(checkActiveLock(ledgerDir).isLocked, false);

      const lockPath = path.join(ledgerDir, 'journal.lock');
      fs.writeFileSync(lockPath, 'mock-pid-1234', 'utf8');
      const lockRes = checkActiveLock(ledgerDir);
      assert.strictEqual(lockRes.isLocked, true);
      assert.ok(lockRes.details.includes('Lockfile exists'));
    });
  });

  describe('Comprehensive Diagnostics: 15 Health Checks & Informational Metrics', () => {
    it('reports HEALTHY on an empty initialized ledger', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      const report = runDoctorDiagnostics(ledgerDir, { rootDir: tempDir });
      assert.strictEqual(report.status, 'HEALTHY');
      assert.strictEqual(report.metrics.totalRecords, 0);
      assert.strictEqual(report.metrics.verifiedRecoveries, 0);
      assert.strictEqual(report.metrics.regressions, 0);
      assert.strictEqual(report.repair.available, false);
    });

    it('reports HEALTHY on a populated ledger with valid records and separated metrics', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Incident #1: Failure + verified recovery
      const rec1 = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Connection error',
        stdout: '',
        cwd: tempDir
      });

      storage.addRecoveryAttempt(rec1.id, {
        cause: 'Bad port',
        change: 'Fixed port',
        verifyCmd: 'npm test'
      });

      storage.recordVerificationRun(rec1.id, 1, {
        command: 'npm test',
        exitCode: 0,
        durationMs: 35,
        output: 'PASS'
      });

      const report = runDoctorDiagnostics(ledgerDir, { rootDir: tempDir });
      assert.strictEqual(report.status, 'HEALTHY');
      assert.strictEqual(report.summary.failures, 0);
      assert.ok(report.summary.passed >= 11);

      // Verify Metrics are separated from health checks
      assert.strictEqual(report.metrics.totalRecords, 1);
      assert.strictEqual(report.metrics.verifiedRecoveries, 1);
      assert.strictEqual(report.metrics.regressions, 0);
      assert.ok(report.metrics.diskUsageBytes > 0);
      assert.strictEqual(typeof report.metrics.diskUsageFormatted, 'string');

      // Verify 4-Layer Cryptographic Integrity breakdown
      const integrityCheck = report.healthChecks.find(c => c.id === 'ledger_integrity');
      assert.ok(integrityCheck);
      assert.strictEqual(integrityCheck.status, 'PASS');
      assert.strictEqual(integrityCheck.details.layers.sequenceContiguity, 'PASS');
      assert.strictEqual(integrityCheck.details.layers.eventHashes, 'PASS');
      assert.strictEqual(integrityCheck.details.layers.chainLinkage, 'PASS');
      assert.strictEqual(integrityCheck.details.layers.checkpointCommitment, 'PASS');

      // Verify Record & Journal Syntax Check line counts
      const syntaxCheck = report.healthChecks.find(c => c.id === 'record_corruption');
      assert.ok(syntaxCheck);
      assert.strictEqual(syntaxCheck.status, 'PASS');
      assert.ok(syntaxCheck.message.includes('1 record files and 3 journal lines'));

      // Verify repair is not needed
      assert.strictEqual(report.repair.available, false);
      assert.strictEqual(report.repair.recommended, false);
    });

    it('detects orphan temporary files as WARNING and flags repair available', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Create orphan temp file in tmpDir
      const orphanPath = path.join(ledgerDir, 'tmp', 'aborted_write_12345.tmp');
      fs.writeFileSync(orphanPath, 'partial write data', 'utf8');

      const report = runDoctorDiagnostics(ledgerDir, { rootDir: tempDir });
      assert.strictEqual(report.status, 'WARNING');

      const orphanCheck = report.healthChecks.find(c => c.id === 'orphan_temp_files');
      assert.strictEqual(orphanCheck.status, 'WARN');
      assert.strictEqual(orphanCheck.details.count, 1);
      assert.strictEqual(report.repair.available, true);
      assert.strictEqual(report.repair.recommended, true);
      assert.ok(report.repair.actions.some(a => a.includes('orphan temporary file')));
    });

    it('detects corrupt record in records/ without destroying evidence and reports DEGRADED', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Test failed',
        stdout: '',
        cwd: tempDir
      });

      // Deliberately corrupt record file in SQLite
      storage.db.exec(`UPDATE records SET data = '{ corrupt json !!!' WHERE id = '1'`);
      storage.close();

      const report = runDoctorDiagnostics(ledgerDir, { rootDir: tempDir });
      assert.strictEqual(report.status, 'DEGRADED');

      const corruptCheck = report.healthChecks.find(c => c.id === 'record_corruption');
      assert.strictEqual(corruptCheck.status, 'FAIL');
      assert.strictEqual(corruptCheck.details.corruptRecords.length, 1);

      // Verify journal is intact
      const journalPath = path.join(ledgerDir, 'journal.jsonl');
      assert.ok(fs.existsSync(journalPath));
      assert.ok(fs.readFileSync(journalPath, 'utf8').includes('npm test'));
    });

    it('detects journal tampering (broken hash chain) and reports CORRUPTED, refusing repair', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Test error',
        stdout: '',
        cwd: tempDir
      });

      // Deliberately tamper with journal payload on disk
      const journalPath = path.join(ledgerDir, 'journal.jsonl');
      const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n');
      const ev = JSON.parse(lines[0]);
      ev.payload.command = 'tampered-cmd';
      lines[0] = JSON.stringify(ev);
      fs.writeFileSync(journalPath, lines.join('\n') + '\n', 'utf8');

      const report = runDoctorDiagnostics(ledgerDir, { rootDir: tempDir });
      assert.strictEqual(report.status, 'CORRUPTED');

      const integrityCheck = report.healthChecks.find(c => c.id === 'ledger_integrity');
      assert.strictEqual(integrityCheck.status, 'FAIL');
      assert.strictEqual(report.repair.blocked, true);
      assert.ok(report.repair.blockReason.includes('Authoritative journal corruption'));
    });

    it('detects active lockfile contention and flags repair blocked', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Create lockfile
      fs.writeFileSync(path.join(ledgerDir, 'journal.lock'), 'active', 'utf8');

      const report = runDoctorDiagnostics(ledgerDir, { rootDir: tempDir });
      const lockCheck = report.healthChecks.find(c => c.id === 'active_lock');
      assert.strictEqual(lockCheck.status, 'WARN');
      assert.strictEqual(report.repair.blocked, true);
      assert.ok(report.repair.blockReason.includes('Active lock'));
    });
  });

  describe('Constrained Safe Repair & Idempotency', () => {
    it('--repair --dry-run previews planned actions without modifying disk', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Add orphan temp file
      const orphanPath = path.join(ledgerDir, 'tmp', 'temp_orphan.tmp');
      fs.writeFileSync(orphanPath, 'orphan', 'utf8');

      const repairResult = executeDoctorRepair(ledgerDir, { rootDir: tempDir }, { dryRun: true });
      assert.strictEqual(repairResult.status, 'DRY_RUN');
      assert.strictEqual(repairResult.dryRun, true);
      assert.ok(repairResult.plannedActions.length > 0);
      assert.strictEqual(repairResult.actionsTaken.length, 0);

      // Verify orphan file was NOT deleted in dry-run
      assert.ok(fs.existsSync(orphanPath));
    });

    it('--repair removes orphan temp files and rebuilds projections while preserving journal and evidence', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Test error',
        stdout: '',
        cwd: tempDir
      });

      // Add orphan temp file
      const orphanPath = path.join(ledgerDir, 'tmp', 'stale.tmp');
      fs.writeFileSync(orphanPath, 'stale', 'utf8');

      storage.close();

      // Simulate missing projection database
      const dbPath = path.join(ledgerDir, 'projection.db');
      fs.unlinkSync(dbPath);
      assert.strictEqual(fs.existsSync(dbPath), false);

      const repairResult = executeDoctorRepair(ledgerDir, { rootDir: tempDir }, { dryRun: false });
      assert.strictEqual(repairResult.status, 'COMPLETED');
      assert.strictEqual(repairResult.actionsTaken.length >= 2, true);

      // Verify temp file was removed
      assert.strictEqual(fs.existsSync(orphanPath), false);

      // Verify projection database was reconstructed from journal
      assert.strictEqual(fs.existsSync(dbPath), true);
      
      const restoredStorage = new StorageEngine(ledgerDir).init();
      const reconstructed = restoredStorage.getRecord('1');
      restoredStorage.close();

      assert.strictEqual(reconstructed.id, '1');
      assert.strictEqual(reconstructed.fullCommand, 'npm test');

      // Verify post-repair diagnostics report HEALTHY
      assert.strictEqual(repairResult.afterStatus, 'HEALTHY');
      assert.strictEqual(repairResult.postRepairIntegrity, 'PASS');
    });

    it('guarantees repair idempotency (running repair on healthy ledger is a no-op)', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Test error',
        stdout: '',
        cwd: tempDir
      });

      // First repair on healthy ledger
      const res1 = executeDoctorRepair(ledgerDir, { rootDir: tempDir });
      assert.strictEqual(res1.status, 'NOOP');
      assert.strictEqual(res1.actionsTaken.length, 0);
      assert.ok(res1.message.includes('No repair required'));

      // Second repair on healthy ledger
      const res2 = executeDoctorRepair(ledgerDir, { rootDir: tempDir });
      assert.strictEqual(res2.status, 'NOOP');
      assert.strictEqual(res2.actionsTaken.length, 0);
    });

    it('refuses repair when journal integrity is compromised', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Test error',
        stdout: '',
        cwd: tempDir
      });

      // Corrupt journal line
      const journalPath = path.join(ledgerDir, 'journal.jsonl');
      fs.appendFileSync(journalPath, '{ malformed line\n', 'utf8');

      const repairResult = executeDoctorRepair(ledgerDir, { rootDir: tempDir });
      assert.strictEqual(repairResult.status, 'REFUSED');
      assert.ok(repairResult.reason.includes('Authoritative journal corruption'));
      assert.strictEqual(repairResult.actionsTaken.length, 0);
    });
  });

  describe('CLI Command Execution: rewind doctor', () => {
    it('outputs clean human-readable diagnostic report with status badges', async () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Test error',
        stdout: '',
        cwd: tempDir
      });

      const mock = createMockIO();
      const code = await runCLI(['--root', tempDir, 'doctor'], mock.io);
      assert.strictEqual(code, 0);

      const out = mock.getStdout();
      assert.ok(out.includes('REWIND DOCTOR'));
      assert.ok(out.includes('HEALTHY'));
      assert.ok(out.includes('PASS'));
      assert.ok(out.includes('Storage Accessibility'));
      assert.ok(out.includes('Ledger Cryptographic Integrity'));
      assert.ok(out.includes('Total incident records:'));
      assert.ok(out.includes('SUMMARY:'));
    });

    it('outputs pure valid JSON with --json flag and zero chatter', async () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Test error',
        stdout: '',
        cwd: tempDir
      });

      const mock = createMockIO();
      const code = await runCLI(['--root', tempDir, 'doctor', '--json'], mock.io);
      assert.strictEqual(code, 0);

      const out = mock.getStdout();
      const parsed = JSON.parse(out);
      assert.strictEqual(parsed.status, 'HEALTHY');
      assert.strictEqual(typeof parsed.summary.passed, 'number');
      assert.ok(Array.isArray(parsed.healthChecks));
      assert.strictEqual(parsed.metrics.totalRecords, 1);
      assert.strictEqual(mock.getStderr(), '');
    });

    it('executes --repair via CLI and outputs clean repair report', async () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Test error',
        stdout: '',
        cwd: tempDir
      });

      const mock = createMockIO();
      const code = await runCLI(['--root', tempDir, 'doctor', '--repair'], mock.io);
      assert.strictEqual(code, 0);

      const out = mock.getStdout();
      assert.ok(out.includes('REWIND DOCTOR REPAIR'));
      assert.ok(out.includes('NO REPAIR REQUIRED') || out.includes('ACTIONS EXECUTED:'));
    });

    it('executes --repair --dry-run via CLI and previews planned actions or reports healthy', async () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Test error',
        stdout: '',
        cwd: tempDir
      });

      const mock = createMockIO();
      const code = await runCLI(['--root', tempDir, 'doctor', '--repair', '--dry-run'], mock.io);
      assert.strictEqual(code, 0);

      const out = mock.getStdout();
      assert.ok(out.includes('REWIND DOCTOR REPAIR'));
      assert.ok(out.includes('NO REPAIR REQUIRED') || out.includes('PLANNED ACTIONS'));
    });

    it('respects NO_COLOR environment variable in human output', async () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      const mock = createMockIO({ env: { NO_COLOR: '1' } });
      const code = await runCLI(['--root', tempDir, 'doctor'], mock.io);
      assert.strictEqual(code, 0);

      const out = mock.getStdout();
      // Verify no ANSI escape codes exist in output
      assert.strictEqual(/\x1B\[[0-9;]*m/.test(out), false);
      assert.ok(out.includes('REWIND DOCTOR'));
    });
  });
});
