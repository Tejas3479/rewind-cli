import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StorageEngine } from '../src/storage/store.js';
import { normalizeRecordToCurrentSchema, isValidRecord } from '../src/storage/record.js';

describe('Schema Migration & Backward Compatibility (src/storage/record.js)', () => {
  test('migrates legacy record format with flat recoveries array to recoveryAttempts and verificationRuns', () => {
    const legacyRecord = {
      id: '1',
      fingerprint: '1234567890abcdef',
      command: 'npm',
      args: ['test'],
      fullCommand: 'npm test',
      cwd: '/app',
      startTime: '2026-08-20T10:00:00Z',
      endTime: '2026-08-20T10:00:05Z',
      durationMs: 5000,
      exitCode: 1,
      signal: null,
      status: 'VERIFIED',
      stdout: 'Tests failed',
      stderr: 'ConnectionRefusedError: 5432',
      normalizedError: 'connectionrefusederror',
      git: { isGit: true, branch: 'main' },
      environment: { platform: 'linux', nodeVersion: 'v20.0.0' },
      regressionOf: null,
      recoveries: [
        {
          timestamp: '2026-08-20T10:05:00Z',
          cause: 'Database down',
          change: 'Started db',
          verifyCmd: 'npm test'
        }
      ],
      verification: {
        verifiedAt: '2026-08-20T10:06:00Z',
        command: 'npm test',
        exitCode: 0,
        durationMs: 120,
        output: 'All tests passed'
      }
    };

    assert.equal(isValidRecord(legacyRecord), true);

    const migrated = normalizeRecordToCurrentSchema(legacyRecord);

    assert.equal(migrated.status, 'RECOVERED');
    assert.equal(Array.isArray(migrated.recoveryAttempts), true);
    assert.equal(migrated.recoveryAttempts.length, 1);
    assert.equal(migrated.recoveryAttempts[0].id, 1);
    assert.equal(migrated.recoveryAttempts[0].status, 'VERIFIED');
    assert.equal(migrated.recoveryAttempts[0].cause, 'Database down');
    assert.equal(migrated.recoveryAttempts[0].change, 'Started db');
    assert.equal(migrated.recoveryAttempts[0].verifyCmd, 'npm test');
    assert.equal(migrated.recoveryAttempts[0].verificationRuns.length, 1);
    assert.equal(migrated.recoveryAttempts[0].verificationRuns[0].result, 'PASSED');
    assert.equal(migrated.recoveryAttempts[0].verificationRuns[0].exitCode, 0);
  });

  test('StorageEngine automatically upgrades legacy records loaded from disk', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-migration-test-'));
    try {
      const recordsDir = path.join(tmpDir, 'records');
      fs.mkdirSync(recordsDir, { recursive: true });

      // Write a raw legacy json file directly
      const legacyJson = {
        id: '1',
        fingerprint: '1234567890abcdef',
        command: 'node',
        args: ['index.js'],
        startTime: '2026-08-20T10:00:00Z',
        exitCode: 1,
        status: 'FIXED',
        stdout: '',
        stderr: 'Error: missing config',
        recoveries: [
          { timestamp: '2026-08-20T10:01:00Z', cause: 'Missing env', change: 'Set ENV', verifyCmd: 'node test.js' }
        ]
      };

      fs.writeFileSync(path.join(recordsDir, '1.json'), JSON.stringify(legacyJson));

      const storage = new StorageEngine(tmpDir).init();
      const loaded = storage.getRecord('1');

      assert.equal(loaded.id, '1');
      assert.equal(loaded.status, 'OPEN');
      assert.equal(Array.isArray(loaded.recoveryAttempts), true);
      assert.equal(loaded.recoveryAttempts.length, 1);
      assert.equal(loaded.recoveryAttempts[0].cause, 'Missing env');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
