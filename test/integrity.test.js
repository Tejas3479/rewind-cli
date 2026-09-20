import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { canonicalStringify, computeCanonicalDigest, CanonicalizationError } from '../src/storage/canonical.js';
import {
  GENESIS_HASH,
  appendJournalEvent,
  readCheckpoint,
  acquireJournalLock,
  LockContentionError
} from '../src/storage/journal.js';
import { verifyLedgerIntegrity } from '../src/storage/integrity.js';
import { StorageEngine } from '../src/storage/store.js';
import { DatabaseSync } from 'node:sqlite';

describe('Local History-Integrity Layer (Tamper Evidence & Event Journal)', () => {
  let tempDir;
  let ledgerDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-integrity-test-'));
    ledgerDir = path.join(tempDir, '.rewind');
  });

  afterEach(() => {
    try {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Strict Canonical JSON Serialization (src/storage/canonical.js)', () => {
    it('produces identical SHA-256 digests regardless of object key insertion order', () => {
      const objA = { z: 1, a: 2, m: { y: 'hello', x: 42 } };
      const objB = { a: 2, m: { x: 42, y: 'hello' }, z: 1 };

      const canonA = canonicalStringify(objA);
      const canonB = canonicalStringify(objB);

      assert.strictEqual(canonA, canonB);
      assert.strictEqual(canonA, '{"a":2,"m":{"x":42,"y":"hello"},"z":1}');
      assert.strictEqual(computeCanonicalDigest(objA), computeCanonicalDigest(objB));
    });

    it('enforces strict UTF-16 code-unit relational ordering', () => {
      const obj = { B: 1, a: 2, A: 3, b: 4, _z: 5 };
      const canon = canonicalStringify(obj);
      // In UTF-16: 'A' (65) < 'B' (66) < '_z' (95) < 'a' (97) < 'b' (98)
      assert.strictEqual(canon, '{"A":3,"B":1,"_z":5,"a":2,"b":4}');
    });

    it('normalizes -0 to 0 and formats finite numbers deterministically', () => {
      const objA = { count: -0 };
      const objB = { count: 0 };
      assert.strictEqual(canonicalStringify(objA), canonicalStringify(objB));
      assert.strictEqual(canonicalStringify(objA), '{"count":0}');
    });

    it('rejects non-finite numbers (NaN, Infinity, -Infinity) fail-closed', () => {
      assert.throws(() => canonicalStringify({ val: Number.NaN }), CanonicalizationError);
      assert.throws(() => canonicalStringify({ val: Number.POSITIVE_INFINITY }), CanonicalizationError);
      assert.throws(() => canonicalStringify({ val: Number.NEGATIVE_INFINITY }), CanonicalizationError);
    });

    it('rejects non-serializable types (undefined, functions, symbols) without silent omission', () => {
      assert.throws(() => canonicalStringify({ secret: undefined }), CanonicalizationError);
      assert.throws(() => canonicalStringify({ fn: () => {} }), CanonicalizationError);
      assert.throws(() => canonicalStringify({ sym: Symbol('test') }), CanonicalizationError);
    });

    it('detects and rejects circular references', () => {
      const circular = { name: 'loop' };
      circular.self = circular;
      assert.throws(() => canonicalStringify(circular), CanonicalizationError);
    });
  });

  describe('Four-Layer Cryptographic Verification & Journal Continuity', () => {
    it('verifies an unbroken SHA-256 event chain across 184 sequential events (TRUSTED)', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Synthesize a realistic 184-event sequence
      for (let i = 1; i <= 184; i++) {
        appendJournalEvent(ledgerDir, {
          type: (i % 5 === 0) ? 'regression.detected' : 'failure.observed',
          incidentId: String(i),
          payload: {
            command: 'npm',
            args: ['test', `--suite=${i}`],
            fullCommand: `npm test --suite=${i}`,
            cwd: tempDir,
            exitCode: 1,
            signal: null,
            durationMs: 20 + i,
            fingerprint: crypto.createHash('sha256').update(`err_${i % 10}`).digest('hex').slice(0, 16),
            normalizedError: `Test suite ${i} failed`,
            evidenceHash: crypto.createHash('sha256').update(`evidence_${i}`).digest('hex'),
            evidenceRef: `evidence/ev_${i}.log`,
            stderrSnippet: `AssertionError in test suite ${i}`,
            stdoutSnippet: '',
            isTruncated: false,
            environment: { platform: 'linux', nodeMajor: 22, envKeysHash: 'abc123' },
            git: { isGit: true, headCommit: 'commit_hash', branch: 'main' },
            regressionOf: (i % 5 === 0) ? String(i - 5) : null
          }
        });
      }

      storage.rebuildProjections();

      const report = verifyLedgerIntegrity(ledgerDir);

      assert.strictEqual(report.status, 'TRUSTED');
      assert.strictEqual(report.isTrusted, true);
      assert.strictEqual(report.journal.examined, 184);
      assert.strictEqual(report.journal.valid, 184);
      assert.strictEqual(report.journal.chainIntact, true);
      assert.strictEqual(report.journal.malformedCount, 0);
      assert.strictEqual(report.checkpoint.matches, true);
      assert.strictEqual(report.checkpoint.headSequence, 184);
      assert.strictEqual(report.errors.length, 0);
    });

    it('detects tampering when an event payload is modified on disk (EVENT_HASH_MISMATCH)', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      // Append 10 valid events
      for (let i = 1; i <= 10; i++) {
        storage.saveRecord({
          command: 'node',
          args: ['app.js'],
          exitCode: 1,
          durationMs: 50,
          stderr: `Error at step ${i}`,
          stdout: '',
          cwd: tempDir
        });
      }

      // Read journal lines, alter event #5's exitCode in payload, and write back
      const journalPath = path.join(ledgerDir, 'journal.jsonl');
      const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n');
      const event5 = JSON.parse(lines[4]);

      // Tamper: change exit code in payload
      event5.payload.exitCode = 0;
      lines[4] = JSON.stringify(event5);
      fs.writeFileSync(journalPath, lines.join('\n') + '\n', 'utf8');

      const report = verifyLedgerIntegrity(ledgerDir);

      assert.strictEqual(report.status, 'UNTRUSTED');
      assert.strictEqual(report.isTrusted, false);
      assert.strictEqual(report.journal.chainIntact, false);

      const mismatchError = report.errors.find(e => e.type === 'EVENT_HASH_MISMATCH');
      assert.ok(mismatchError, 'Expected EVENT_HASH_MISMATCH error');
      assert.strictEqual(mismatchError.sequence, 5);
      assert.strictEqual(mismatchError.incidentId, '5');
    });

    it('detects intermediate event deletion (CHAIN_BREAK & SEQUENCE_GAP)', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      for (let i = 1; i <= 5; i++) {
        storage.saveRecord({
          command: 'pytest',
          args: [`test_${i}.py`],
          exitCode: 1,
          durationMs: 30,
          stderr: `Failed test ${i}`,
          stdout: '',
          cwd: tempDir
        });
      }

      // Delete event #3 from the journal
      const journalPath = path.join(ledgerDir, 'journal.jsonl');
      const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n');
      lines.splice(2, 1); // remove index 2 (event #3)
      fs.writeFileSync(journalPath, lines.join('\n') + '\n', 'utf8');

      const report = verifyLedgerIntegrity(ledgerDir);

      assert.strictEqual(report.status, 'UNTRUSTED');
      assert.strictEqual(report.isTrusted, false);

      const seqGap = report.errors.find(e => e.type === 'SEQUENCE_GAP');
      assert.ok(seqGap, 'Expected SEQUENCE_GAP error at deleted sequence');
      assert.strictEqual(seqGap.sequence, 4);

      const chainBreak = report.errors.find(e => e.type === 'CHAIN_BREAK');
      assert.ok(chainBreak, 'Expected CHAIN_BREAK error');
    });

    it('detects tail deletion via trusted checkpoint anchor (CHECKPOINT_MISMATCH)', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      for (let i = 1; i <= 10; i++) {
        storage.saveRecord({
          command: 'cargo',
          args: ['test'],
          exitCode: 1,
          durationMs: 40,
          stderr: `Cargo error ${i}`,
          stdout: '',
          cwd: tempDir
        });
      }

      // Verify checkpoint points to sequence 10
      const checkpoint = readCheckpoint(ledgerDir);
      assert.strictEqual(checkpoint.headSequence, 10);

      // Truncate the last 2 events from journal.jsonl (tail deletion)
      const journalPath = path.join(ledgerDir, 'journal.jsonl');
      const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n');
      lines.splice(8, 2); // remove events 9 and 10
      fs.writeFileSync(journalPath, lines.join('\n') + '\n', 'utf8');

      const report = verifyLedgerIntegrity(ledgerDir);

      assert.strictEqual(report.status, 'UNTRUSTED');
      assert.strictEqual(report.isTrusted, false);

      const tailError = report.errors.find(e => e.type === 'CHECKPOINT_MISMATCH');
      assert.ok(tailError, 'Expected CHECKPOINT_MISMATCH on tail deletion');
    });

    it('detects journal-only rewrite attack when trusted checkpoint remains unchanged', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      for (let i = 1; i <= 5; i++) {
        storage.saveRecord({
          command: 'node',
          args: ['server.js'],
          exitCode: 1,
          durationMs: 50,
          stderr: `Original error ${i}`,
          stdout: '',
          cwd: tempDir
        });
      }

      const checkpoint = readCheckpoint(ledgerDir);
      const originalHeadHash = checkpoint.headChainHash;

      // Attacker rewrites entire journal from Genesis with fake events and recalculated hashes
      const journalPath = path.join(ledgerDir, 'journal.jsonl');
      let prevHash = GENESIS_HASH;
      const fakeLines = [];

      for (let i = 1; i <= 5; i++) {
        const payload = { command: 'node', args: ['server.js'], exitCode: 1, stderrSnippet: `Fake altered text ${i}` };
        const eventContent = {
          journalFormatVersion: 1,
          eventSchemaVersion: 1,
          sequence: i,
          eventId: `evt_fake_${i}`,
          timestamp: new Date().toISOString(),
          type: 'failure.observed',
          incidentId: String(i),
          payload
        };
        const eventHash = computeCanonicalDigest(eventContent);
        const chainHash = crypto.createHash('sha256').update(`${prevHash}:${eventHash}`).digest('hex');
        fakeLines.push(canonicalStringify({ ...eventContent, prevHash, eventHash, chainHash }));
        prevHash = chainHash;
      }

      fs.writeFileSync(journalPath, fakeLines.join('\n') + '\n', 'utf8');

      // The journal is internally self-consistent, but checkpoint anchor does NOT match!
      const report = verifyLedgerIntegrity(ledgerDir);

      assert.strictEqual(report.status, 'UNTRUSTED');
      assert.strictEqual(report.isTrusted, false);
      const checkpointMismatch = report.errors.find(e => e.type === 'CHECKPOINT_MISMATCH');
      assert.ok(checkpointMismatch, 'Expected CHECKPOINT_MISMATCH against original trusted anchor');
    });

    it('detects derived projection drift when records/*.json is manually edited on disk', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({
        command: 'npm',
        args: ['test'],
        exitCode: 1,
        durationMs: 35,
        stderr: 'Original unadulterated error',
        stdout: '',
        cwd: tempDir
      });

      storage.close();

      // Manually edit records in projection database
      const dbPath = path.join(ledgerDir, 'projection.db');
      const db = new DatabaseSync(dbPath);
      const row = db.prepare('SELECT data FROM records WHERE id = ?').get('1');
      const parsed = JSON.parse(row.data);
      parsed.stderr = 'Tampered record file content';
      db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify(parsed), '1');
      db.close();

      const report = verifyLedgerIntegrity(ledgerDir);

      assert.strictEqual(report.status, 'UNTRUSTED');
      const driftError = report.errors.find(e => e.type === 'PROJECTION_DRIFT');
      assert.ok(driftError, 'Expected PROJECTION_DRIFT error');
      assert.strictEqual(driftError.incidentId, '1');
    });

    it('handles malformed JSON lines in journal without crashing (MALFORMED_RECORD)', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({ command: 'test', exitCode: 1, stderr: 'err 1', cwd: tempDir });

      // Corrupt line 2
      const journalPath = path.join(ledgerDir, 'journal.jsonl');
      fs.appendFileSync(journalPath, '{{{ MALFORMED CORRUPTED JSON LINE\n', 'utf8');

      const report = verifyLedgerIntegrity(ledgerDir);

      assert.strictEqual(report.status, 'UNTRUSTED');
      assert.strictEqual(report.journal.malformedCount, 1);
      const malformedErr = report.errors.find(e => e.type === 'MALFORMED_RECORD');
      assert.ok(malformedErr, 'Expected MALFORMED_RECORD error');
    });

    it('maintains strict read-only invariant (never mutates disk during verification)', () => {
      const storage = new StorageEngine(ledgerDir);
      storage.init();

      storage.saveRecord({ command: 'node', exitCode: 1, stderr: 'err', cwd: tempDir });

      const journalPath = path.join(ledgerDir, 'journal.jsonl');
      const beforeStat = fs.statSync(journalPath);
      const beforeContent = fs.readFileSync(journalPath, 'utf8');

      // Run verification multiple times
      verifyLedgerIntegrity(ledgerDir);
      verifyLedgerIntegrity(ledgerDir);

      const afterStat = fs.statSync(journalPath);
      const afterContent = fs.readFileSync(journalPath, 'utf8');

      assert.strictEqual(beforeContent, afterContent);
      assert.strictEqual(beforeStat.mtimeMs, afterStat.mtimeMs);
    });
  });

  describe('Conservative Concurrency & Lock Safety', () => {
    it('acquires lock, writes atomically, and safely releases', () => {
      const lockPath = path.join(ledgerDir, 'journal.lock');
      fs.mkdirSync(ledgerDir, { recursive: true });

      const lock = acquireJournalLock(lockPath, { timeoutMs: 1000 });
      assert.ok(fs.existsSync(lockPath));

      lock.release();
      assert.strictEqual(fs.existsSync(lockPath), false);
    });

    it('rejects concurrent lock acquisition when active lock is held', () => {
      const lockPath = path.join(ledgerDir, 'journal.lock');
      fs.mkdirSync(ledgerDir, { recursive: true });

      const lock1 = acquireJournalLock(lockPath, { timeoutMs: 1000 });
      assert.ok(fs.existsSync(lockPath));

      assert.throws(
        () => acquireJournalLock(lockPath, { timeoutMs: 200 }),
        LockContentionError
      );

      lock1.release();
    });
  });
});
