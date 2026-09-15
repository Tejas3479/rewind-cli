import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { StorageEngine } from '../src/storage/store.js';
import { appendJournalEvent } from '../src/storage/journal.js';
import { buildAgentContext, CONTEXT_SCHEMA_VERSION } from '../src/storage/context.js';
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

describe('Agent-Consumption Interface (src/storage/context.js & rewind context)', () => {
  let tempDir;
  let ledgerDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-context-test-'));
    ledgerDir = path.join(tempDir, '.rewind');
  });

  afterEach(() => {
    try {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Contract Structure & Schema Integrity', () => {
    it('returns empty context payload with exit 0 when ledger is empty', () => {
      const context = buildAgentContext(ledgerDir, 'latest');
      assert.strictEqual(context.status, 'empty');
      assert.strictEqual(context.contextSchemaVersion, CONTEXT_SCHEMA_VERSION);
      assert.strictEqual(context.sourceJournalFormat, 1);
      assert.strictEqual(context.observedEvidence, null);
      assert.strictEqual(context.derivedAnalysis, null);
      assert.strictEqual(context.safety.readOnly, true);
      assert.strictEqual(context.safety.mayAutoExecuteCommands, false);
    });

    it('resolves latest incident correctly and structures observed vs derived analysis', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Incident #1
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'ConnectionRefused port 5432',
        stdout: '',
        cwd: tempDir
      });

      // Incident #2 (Latest)
      storage.saveRecord({
        command: 'npm',
        args: ['run', 'build'],
        fullCommand: 'npm run build',
        exitCode: 2,
        durationMs: 120,
        stderr: 'TS2304: Cannot find name "ConfigMap"',
        stdout: '',
        cwd: tempDir
      });

      const context = buildAgentContext(ledgerDir, 'latest');
      assert.strictEqual(context.status, 'success');
      assert.strictEqual(context.query.target, 'latest');
      assert.strictEqual(context.query.resolvedIncidentId, '2');
      assert.strictEqual(context.observedEvidence.failure.id, '2');
      assert.strictEqual(context.observedEvidence.failure.command, 'npm');
      assert.ok(context.observedEvidence.failure.createdAt);
      assert.strictEqual(typeof context.observedEvidence.failure.createdAt, 'string');
      assert.strictEqual(context.ledgerTrust.isTrusted, true);
      assert.strictEqual(context.safety.mayAutoExecuteCommands, false);
      assert.ok(Array.isArray(context.warnings));
      assert.strictEqual(typeof context.recommendedAction, 'string');
      assert.ok(Array.isArray(context.allowedNextActions));
    });

    it('resolves explicit incident ID accurately and throws for non-existent ID', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 40,
        stderr: 'Error 1',
        stdout: '',
        cwd: tempDir
      });

      const context1 = buildAgentContext(ledgerDir, '1');
      assert.strictEqual(context1.observedEvidence.failure.id, '1');

      assert.throws(() => {
        buildAgentContext(ledgerDir, '999');
      }, /not found in authoritative ledger/);
    });
  });

  describe('Historical Evidence, Remedies & Provenance', () => {
    it('surfaces verified remedies with exact provenance and applicability status', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Incident #1: Failure + verified recovery
      const rec1 = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'Database pool exhausted',
        stdout: '',
        cwd: tempDir,
        environment: { platform: 'linux', nodeMajor: 22 }
      });

      storage.addRecoveryAttempt(rec1.id, {
        cause: 'Pool size was 1',
        change: 'Increased pool size to 20',
        verifyCmd: 'npm test'
      });

      storage.recordVerificationRun(rec1.id, 1, {
        command: 'npm test',
        exitCode: 0,
        durationMs: 45,
        output: 'PASS: 10 tests'
      });

      // Incident #2: Same failure occurring later
      const rec2 = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'Database pool exhausted',
        stdout: '',
        cwd: tempDir,
        environment: { platform: 'linux', nodeMajor: 22 }
      });

      const context = buildAgentContext(ledgerDir, 'latest', {
        currentEnv: { platform: 'linux', nodeMajor: 22 }
      });
      assert.strictEqual(context.observedEvidence.remedies.hasVerifiedRemedy, true);
      assert.strictEqual(context.observedEvidence.remedies.verifiedCount, 1);

      const verified = context.observedEvidence.remedies.verified[0];
      assert.strictEqual(verified.type, 'HISTORICAL_RECOVERY');
      assert.strictEqual(verified.status, 'VERIFIED');
      assert.strictEqual(verified.trustLevel, 'VERIFIED_IN_LEDGER');
      assert.strictEqual(verified.action, 'REVIEW');
      assert.strictEqual(verified.provenance.sourceIncidentId, '1');
      assert.strictEqual(verified.provenance.sourceRecoveryAttemptId, 1);
      assert.strictEqual(verified.verificationCommand.command, 'npm test');
      assert.strictEqual(verified.verificationCommand.mayAutoExecute, false);
      assert.strictEqual(verified.currentApplicability.status, 'APPLICABLE');
    });

    it('surfaces negative memory (failed approaches) with explicit warning', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      const rec1 = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'Connection error',
        stdout: '',
        cwd: tempDir
      });

      // Add failed recovery attempt
      storage.addRecoveryAttempt(rec1.id, {
        cause: 'Wrong port',
        change: 'Changed port to 9999',
        verifyCmd: 'npm test'
      });

      storage.recordVerificationRun(rec1.id, 1, {
        command: 'npm test',
        exitCode: 1,
        durationMs: 30,
        output: 'FAIL: connection refused'
      });

      const context = buildAgentContext(ledgerDir, 'latest');
      assert.strictEqual(context.observedEvidence.remedies.failedCount, 1);
      const failed = context.observedEvidence.remedies.failedApproaches[0];
      assert.strictEqual(failed.type, 'FAILED_APPROACH');
      assert.strictEqual(failed.status, 'FAILED');
      assert.ok(failed.warning.includes('failed verification'));
    });

    it('distinguishes structurally between exact and similar matches', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Incident #1: Exact same error
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'FATAL: database connection pool exhausted',
        stdout: '',
        cwd: tempDir
      });

      // Incident #2: Similar error
      storage.saveRecord({
        command: 'npm',
        args: ['run', 'db:migrate'],
        fullCommand: 'npm run db:migrate',
        exitCode: 1,
        durationMs: 50,
        stderr: 'connection pool timeout while acquiring client',
        stdout: '',
        cwd: tempDir
      });

      // Incident #3: Exact same error as #1 (Latest)
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'FATAL: database connection pool exhausted',
        stdout: '',
        cwd: tempDir
      });

      const context = buildAgentContext(ledgerDir, 'latest');
      assert.strictEqual(context.observedEvidence.historicalMatches.exactCount, 1);
      assert.strictEqual(context.observedEvidence.historicalMatches.exact[0].matchType, 'EXACT');
      assert.strictEqual(context.observedEvidence.historicalMatches.exact[0].similarity, null);

      assert.ok(context.observedEvidence.historicalMatches.similarCount >= 1);
      const sim = context.observedEvidence.historicalMatches.similar[0];
      assert.strictEqual(sim.matchType, 'SIMILAR');
      assert.strictEqual(typeof sim.similarity, 'number');
    });
  });

  describe('Integrity & Trust Boundary Enforcement', () => {
    it('downgrades verified remedies when journal integrity is UNTRUSTED', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      const rec = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'Error 1',
        stdout: '',
        cwd: tempDir
      });

      storage.addRecoveryAttempt(rec.id, {
        cause: 'Config error',
        change: 'Updated config.json',
        verifyCmd: 'npm test'
      });

      storage.recordVerificationRun(rec.id, 1, {
        command: 'npm test',
        exitCode: 0,
        durationMs: 30,
        output: 'PASS'
      });

      // Deliberately tamper with event in journal.jsonl
      const journalPath = path.join(ledgerDir, 'journal.jsonl');
      const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n');
      const event0 = JSON.parse(lines[0]);
      event0.payload.exitCode = 0; // Alter payload on disk
      lines[0] = JSON.stringify(event0);
      fs.writeFileSync(journalPath, lines.join('\n') + '\n', 'utf8');

      const context = buildAgentContext(ledgerDir, 'latest');
      assert.strictEqual(context.ledgerTrust.isTrusted, false);
      assert.strictEqual(context.ledgerTrust.status, 'UNTRUSTED');
      assert.strictEqual(context.observedEvidence.remedies.hasVerifiedRemedy, false);

      const remedy = context.observedEvidence.remedies.verified[0];
      assert.strictEqual(remedy.status, 'UNTRUSTED_EVIDENCE');
      assert.strictEqual(remedy.trustLevel, 'UNTRUSTED_INTEGRITY_VIOLATION');
      assert.ok(context.suggestedActions.includes('AUDIT_LEDGER_INTEGRITY'));
    });
  });

  describe('Security, Secret Redaction & Context Bounding', () => {
    it('redacts sensitive API keys and tokens from failure logs in agent context', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      const secretKey = ['sk', 'proj', 'supersecrettoken12345678901234'].join('-');
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: `Failed with authorization key: ${secretKey} in config.json`,
        stdout: '',
        cwd: tempDir
      });

      const context = buildAgentContext(ledgerDir, 'latest');
      const stderr = context.observedEvidence.failure.stderrSnippet;

      assert.strictEqual(stderr.includes(secretKey), false);
      assert.ok(stderr.includes('[REDACTED_API_KEY]'));
    });

    it('bounds enormous log snippets to prevent context explosion', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      const hugeLog = 'LOG ENTRY ERROR '.repeat(5000); // ~80,000 characters
      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: hugeLog,
        stdout: '',
        cwd: tempDir
      });

      const context = buildAgentContext(ledgerDir, 'latest', { maxSnippetChars: 500 });
      const snippet = context.observedEvidence.failure.stderrSnippet;

      assert.ok(snippet.length <= 600);
      assert.ok(snippet.includes('[... truncated'));
    });
  });

  describe('CLI Command Execution: rewind context', () => {
    it('outputs pure valid JSON with --json flag and zero human output chatter', async () => {
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
      const code = await runCLI(['--root', tempDir, 'context', 'latest', '--json'], mock.io);
      assert.strictEqual(code, 0);

      const stdout = mock.getStdout();
      const parsed = JSON.parse(stdout);
      assert.strictEqual(parsed.status, 'success');
      assert.strictEqual(parsed.observedEvidence.failure.command, 'npm');
      assert.strictEqual(mock.getStderr(), '');
    });

    it('formats clean human-readable diagnostic card in text mode', async () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        durationMs: 50,
        stderr: 'Database connection error',
        stdout: '',
        cwd: tempDir
      });

      const mock = createMockIO();
      const code = await runCLI(['--root', tempDir, 'context', 'latest'], mock.io);
      assert.strictEqual(code, 0);

      const out = mock.getStdout();
      assert.ok(out.includes('REWIND AGENT CONTEXT'));
      assert.ok(out.includes('LEDGER TRUSTED'));
      assert.ok(out.includes('npm test'));
      assert.ok(out.includes('SUGGESTED NEXT ACTIONS'));
    });

    it('handles empty ledger gracefully in JSON mode with exit code 0', async () => {
      const mock = createMockIO();
      const code = await runCLI(['--root', tempDir, 'context', 'latest', '--json'], mock.io);
      assert.strictEqual(code, 0);

      const parsed = JSON.parse(mock.getStdout());
      assert.strictEqual(parsed.status, 'empty');
      assert.strictEqual(parsed.observedEvidence, null);
    });
  });
});
