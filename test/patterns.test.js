import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { StorageEngine } from '../src/storage/store.js';
import { appendJournalEvent } from '../src/storage/journal.js';
import {
  analyzePatternsFromJournal,
  PatternTypes,
  normalizeCommandIdentity,
  normalizeRecoveryHypothesis
} from '../src/storage/patterns.js';
import { runCLI } from '../src/cli.js';

function createMockIO({ isTTY = false } = {}) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk) => { stdout += chunk; return true; } },
      stderr: { write: (chunk) => { stderr += chunk; return true; } },
      stdin: {},
      env: {},
      isTTY,
      cwd: process.cwd()
    },
    getStdout: () => stdout,
    getStderr: () => stderr
  };
}

describe('Pattern Intelligence Layer (src/storage/patterns.js)', () => {
  let tempDir;
  let ledgerDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-patterns-test-'));
    ledgerDir = path.join(tempDir, '.rewind');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Normalization Utilities', () => {
    it('normalizes command identity predictably', () => {
      assert.strictEqual(
        normalizeCommandIdentity('npm', ['test', '--bail']),
        'npm test --bail'
      );
      assert.strictEqual(
        normalizeCommandIdentity('  pytest  ', ['-v', 'test.py']),
        'pytest -v test.py'
      );
    });

    it('normalizes recovery hypothesis without NLP/AI', () => {
      assert.strictEqual(
        normalizeRecoveryHypothesis('Increase timeout to 120s'),
        'increase timeout to 120s'
      );
      assert.strictEqual(
        normalizeRecoveryHypothesis('  Increased timeout to 120s!  '),
        'increased timeout to 120s'
      );
    });
  });

  describe('Pattern Classifications & Evidentiary Rules', () => {
    it('classifies RECURRING_FAILURE for >= 2 occurrences and ignores isolated single failures', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      const fpRecurring = 'a1b2c3d4e5f6';
      const fpIsolated = '998877665544';

      // Record 3 occurrences of fpRecurring
      for (let i = 1; i <= 3; i++) {
        storage.saveRecord({
          command: 'npm',
          args: ['test'],
          fullCommand: 'npm test',
          exitCode: 1,
          durationMs: 50,
          stderr: 'ConnectionRefusedError: port 5432',
          stdout: '',
          cwd: tempDir
        });
      }

      // Record 1 occurrence of fpIsolated
      storage.saveRecord({
        command: 'cargo',
        args: ['build'],
        fullCommand: 'cargo build',
        exitCode: 101,
        durationMs: 200,
        stderr: 'error[E0425]: cannot find value `foo` in this scope',
        stdout: '',
        cwd: tempDir
      });

      const report = analyzePatternsFromJournal(ledgerDir);
      assert.strictEqual(report.uniqueFingerprints, 2);

      const recurringReport = report.patterns.find((p) => p.totalIncidents === 3);
      assert.ok(recurringReport);
      assert.ok(recurringReport.firstSeen);
      assert.ok(recurringReport.lastSeen);
      assert.strictEqual(typeof recurringReport.firstSeen, 'string');
      assert.strictEqual(typeof recurringReport.lastSeen, 'string');
      assert.ok(recurringReport.classifications.some((c) => c.type === PatternTypes.RECURRING_FAILURE));

      const isolatedReport = report.patterns.find((p) => p.totalIncidents === 1);
      assert.ok(isolatedReport);
      assert.strictEqual(
        isolatedReport.classifications.some((c) => c.type === PatternTypes.RECURRING_FAILURE),
        false
      );
    });

    it('classifies RECURRING_REGRESSION only when linked to an authoritative verified parent', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Incident #1: Failure observed, recovery added, verified
      const rec1 = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'Database pool empty',
        stdout: '',
        cwd: tempDir
      });

      storage.addRecoveryAttempt(rec1.id, {
        cause: 'Pool size 1',
        change: 'Pool size 20',
        verifyCmd: 'npm test'
      });

      storage.recordVerificationRun(rec1.id, 1, {
        command: 'npm test',
        exitCode: 0,
        durationMs: 40,
        output: 'PASS'
      });

      // Incident #2: Recurring failure matching verified incident #1
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'Database pool empty',
        stdout: '',
        cwd: tempDir
      }, {
        initialState: 'REGRESSED',
        regressionOf: String(rec1.id)
      });

      const report = analyzePatternsFromJournal(ledgerDir);
      assert.strictEqual(report.patterns.length, 1);
      const fam = report.patterns[0];

      const regressionClass = fam.classifications.find((c) => c.type === PatternTypes.RECURRING_REGRESSION);
      assert.ok(regressionClass, 'Should classify as RECURRING_REGRESSION');
      assert.strictEqual(regressionClass.evidence.regressionsCount, 1);
      assert.strictEqual(regressionClass.evidence.links[0].regressionOf, String(rec1.id));
    });

    it('classifies LIKELY_FLAKY on >= 3 runs with identical commit + command + mixed outcomes', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      const commit = 'abc1234567890abcdef1234567890abcdef12';

      // Incident #1 with verification runs under the same commit
      const rec = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'WorkerTimeout: test/e2e/auth.spec.ts',
        stdout: '',
        cwd: tempDir,
        git: { isGit: true, headCommit: commit, branch: 'main' },
        environment: { platform: 'linux', nodeMajor: 22 }
      });

      // Add recovery attempt with verification runs: 2 pass, 1 fail
      storage.addRecoveryAttempt(rec.id, {
        cause: 'Timing jitter',
        change: 'Retry test',
        verifyCmd: 'npm test'
      });

      storage.recordVerificationRun(rec.id, 1, {
        command: 'npm test',
        exitCode: 0,
        durationMs: 60,
        output: 'PASS'
      });

      storage.recordVerificationRun(rec.id, 1, {
        command: 'npm test',
        exitCode: 0,
        durationMs: 60,
        output: 'PASS'
      });

      storage.recordVerificationRun(rec.id, 1, {
        command: 'npm test',
        exitCode: 1,
        durationMs: 60,
        output: 'WorkerTimeout'
      });

      const report = analyzePatternsFromJournal(ledgerDir);
      const fam = report.patterns[0];
      const flakyClass = fam.classifications.find((c) => c.type === PatternTypes.LIKELY_FLAKY);

      assert.ok(flakyClass, 'Should detect LIKELY_FLAKY');
      assert.strictEqual(flakyClass.evidence.passes, 2);
      assert.strictEqual(flakyClass.evidence.failures, 2); // Initial run + 1 failed verify
      assert.strictEqual(flakyClass.causality, 'NOT PROVEN');
    });

    it('classifies LIKELY_VARIABLE when variations occur across differing commits without flakiness proof', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Incident on commit 1
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'AssertionError',
        stdout: '',
        cwd: tempDir,
        git: { isGit: true, headCommit: 'commit_aaaa', branch: 'main' },
        environment: { platform: 'linux', nodeMajor: 22 }
      });

      // Incident on commit 2
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'AssertionError',
        stdout: '',
        cwd: tempDir,
        git: { isGit: true, headCommit: 'commit_bbbb', branch: 'feature' },
        environment: { platform: 'linux', nodeMajor: 22 }
      });

      const report = analyzePatternsFromJournal(ledgerDir);
      const fam = report.patterns[0];
      assert.strictEqual(fam.classifications.some((c) => c.type === PatternTypes.LIKELY_FLAKY), false);
      assert.ok(fam.classifications.some((c) => c.type === PatternTypes.LIKELY_VARIABLE));
    });

    it('requires comparative exposure for ENVIRONMENT_CORRELATED (avoids false platform claims)', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // 4 incidents on Linux ONLY (no Windows runs ever observed)
      for (let i = 1; i <= 4; i++) {
        storage.saveRecord({
          command: 'npm',
          args: ['test'],
          fullCommand: 'npm test',
          exitCode: 1,
          durationMs: 40,
          stderr: 'Missing native binary',
          stdout: '',
          cwd: tempDir,
          environment: { platform: 'linux', nodeMajor: 22 }
        });
      }

      let report = analyzePatternsFromJournal(ledgerDir);
      let fam = report.patterns[0];
      // Since all 4 ran on Linux only without any Windows/Darwin runs, we must NOT claim Linux sensitivity
      assert.strictEqual(
        fam.classifications.some((c) => c.type === PatternTypes.ENVIRONMENT_CORRELATED),
        false,
        'Should NOT claim environment correlation when only 1 platform was tested'
      );

      // Now add 1 incident on win32 to provide multi-platform comparative exposure
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Missing native binary',
        stdout: '',
        cwd: tempDir,
        environment: { platform: 'win32', nodeMajor: 22 }
      });

      report = analyzePatternsFromJournal(ledgerDir);
      fam = report.patterns[0];
      const envClass = fam.classifications.find((c) => c.type === PatternTypes.ENVIRONMENT_CORRELATED);
      assert.ok(envClass, 'Should classify as ENVIRONMENT_CORRELATED when 4/5 are Linux across multi-platform tests');
      assert.strictEqual(envClass.causality, 'NOT PROVEN');
    });

    it('requires comparative exposure for RUNTIME_CORRELATED (avoids false Node version claims)', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // 4 incidents on Node 22 ONLY
      for (let i = 1; i <= 4; i++) {
        storage.saveRecord({
          command: 'npm',
          args: ['test'],
          fullCommand: 'npm test',
          exitCode: 1,
          durationMs: 40,
          stderr: 'DeprecationWarning: punycode is deprecated',
          stdout: '',
          cwd: tempDir,
          environment: { platform: 'linux', nodeMajor: 22 }
        });
      }

      let report = analyzePatternsFromJournal(ledgerDir);
      let fam = report.patterns[0];
      assert.strictEqual(
        fam.classifications.some((c) => c.type === PatternTypes.RUNTIME_CORRELATED),
        false,
        'Should NOT claim runtime correlation without comparative runtime exposure'
      );

      // Add 1 incident on Node 20
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'DeprecationWarning: punycode is deprecated',
        stdout: '',
        cwd: tempDir,
        environment: { platform: 'linux', nodeMajor: 20 }
      });

      report = analyzePatternsFromJournal(ledgerDir);
      fam = report.patterns[0];
      assert.ok(fam.classifications.some((c) => c.type === PatternTypes.RUNTIME_CORRELATED));
    });

    it('classifies COMMAND_CORRELATED when 100% of failures originate from a single distinct command', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      for (let i = 1; i <= 3; i++) {
        storage.saveRecord({
          command: 'npm',
          args: ['run', 'test:e2e'],
          fullCommand: 'npm run test:e2e',
          exitCode: 1,
          durationMs: 80,
          stderr: 'Cypress verification timed out',
          stdout: '',
          cwd: tempDir
        });
      }

      const report = analyzePatternsFromJournal(ledgerDir);
      const fam = report.patterns[0];
      const cmdClass = fam.classifications.find((c) => c.type === PatternTypes.COMMAND_CORRELATED);
      assert.ok(cmdClass);
      assert.strictEqual(cmdClass.evidence.commandIdentity, 'npm run test:e2e');
      assert.strictEqual(cmdClass.causality, 'NOT PROVEN');
    });

    it('classifies REPEATED_FAILED_RECOVERY and FREQUENTLY_VERIFIED_RECOVERY with historical rates', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Incident #1: Failed attempt and then verified attempt
      const rec1 = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'Connection timeout',
        stdout: '',
        cwd: tempDir
      });

      storage.addRecoveryAttempt(rec1.id, {
        cause: 'Bad port',
        change: 'Restart server',
        verifyCmd: 'npm test'
      });
      storage.recordVerificationRun(rec1.id, 1, {
        command: 'npm test',
        exitCode: 1,
        durationMs: 30,
        output: 'FAIL'
      });

      storage.addRecoveryAttempt(rec1.id, {
        cause: 'Firewall blocking port',
        change: 'Opened port 5432 in firewall',
        verifyCmd: 'npm test'
      });
      storage.recordVerificationRun(rec1.id, 2, {
        command: 'npm test',
        exitCode: 0,
        durationMs: 30,
        output: 'PASS'
      });

      // Incident #2: Same failed attempt and same verified attempt
      const rec2 = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'Connection timeout',
        stdout: '',
        cwd: tempDir
      });

      storage.addRecoveryAttempt(rec2.id, {
        cause: 'Bad port',
        change: 'Restart server',
        verifyCmd: 'npm test'
      });
      storage.recordVerificationRun(rec2.id, 1, {
        command: 'npm test',
        exitCode: 1,
        durationMs: 30,
        output: 'FAIL'
      });

      storage.addRecoveryAttempt(rec2.id, {
        cause: 'Firewall blocking port',
        change: 'Opened port 5432 in firewall',
        verifyCmd: 'npm test'
      });
      storage.recordVerificationRun(rec2.id, 2, {
        command: 'npm test',
        exitCode: 0,
        durationMs: 30,
        output: 'PASS'
      });

      const report = analyzePatternsFromJournal(ledgerDir);
      const fam = report.patterns[0];

      const failedRecoveryClass = fam.classifications.find((c) => c.type === PatternTypes.REPEATED_FAILED_RECOVERY);
      assert.ok(failedRecoveryClass, 'Should identify repeated failed recovery');
      assert.strictEqual(failedRecoveryClass.evidence.failedAttempts, 2);

      const verifiedRecoveryClass = fam.classifications.find((c) => c.type === PatternTypes.FREQUENTLY_VERIFIED_RECOVERY);
      assert.ok(verifiedRecoveryClass, 'Should identify frequently verified recovery');
      assert.strictEqual(verifiedRecoveryClass.evidence.verifiedCount, 2);
      assert.strictEqual(verifiedRecoveryClass.evidence.verificationRatePercent, 100);
    });
  });

  describe('Data Lineage & Poisoning Invariance', () => {
    it('derives pattern intelligence exclusively from journal, ignoring corrupt records/ files', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      for (let i = 1; i <= 3; i++) {
        storage.saveRecord({
          command: 'npm',
          args: ['test'],
          fullCommand: 'npm test',
          exitCode: 1,
          durationMs: 50,
          stderr: 'Memory limit exceeded',
          stdout: '',
          cwd: tempDir
        });
      }

      // Deliberately corrupt a projected record on disk in .rewind/records/
      const recordPath = path.join(ledgerDir, 'records', '1.json');
      if (fs.existsSync(recordPath)) {
        fs.writeFileSync(recordPath, '{"id":"1","fingerprint":"CORRUPT_POISON"}', 'utf8');
      }

      // Pattern analysis should still correctly replay from journal.jsonl
      const report = analyzePatternsFromJournal(ledgerDir);
      assert.strictEqual(report.patternFamiliesCount, 1);
      assert.strictEqual(report.patterns[0].totalIncidents, 3);
      assert.notStrictEqual(report.patterns[0].fingerprint, 'CORRUPT_POISON');
    });
  });

  describe('CLI Commands: rewind patterns', () => {
    it('displays formatted text pattern report with explanations (--explain)', async () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      for (let i = 1; i <= 3; i++) {
        storage.saveRecord({
          command: 'npm',
          args: ['test'],
          fullCommand: 'npm test',
          exitCode: 1,
          durationMs: 50,
          stderr: 'Database connection failed',
          stdout: '',
          cwd: tempDir
        });
      }

      const mock = createMockIO();
      const code = await runCLI(['--root', tempDir, 'patterns', '--explain'], mock.io);
      assert.strictEqual(code, 0);

      const out = mock.getStdout();
      assert.ok(out.includes('PATTERN INTELLIGENCE REPORT'));
      assert.ok(out.includes('RECURRING_FAILURE'));
      assert.ok(out.includes('Evidence Explanations & Reasoning (--explain)'));
      assert.ok(out.includes('Causality:'));
    });

    it('outputs pure structured JSON with --json flag', async () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'Test failed',
        stdout: '',
        cwd: tempDir
      });

      const mock = createMockIO();
      const code = await runCLI(['--root', tempDir, 'patterns', '--json'], mock.io);
      assert.strictEqual(code, 0);

      const parsed = JSON.parse(mock.getStdout());
      assert.strictEqual(parsed.status, 'success');
      assert.strictEqual(parsed.data.patternFamiliesCount, 1);
      assert.strictEqual(parsed.data.analyzedEvents, 1);
    });

    it('displays friendly notice when ledger is empty', async () => {
      const mock = createMockIO();
      const code = await runCLI(['--root', tempDir, 'patterns'], mock.io);
      assert.strictEqual(code, 0);
      assert.ok(mock.getStdout().includes('No failure patterns detected in ledger'));
    });
  });
});
