import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFingerprint,
  computeLegacyFingerprint,
  fingerprintsMatch,
  formatShortFingerprint,
  inferFingerprintVersion,
  FINGERPRINT_VERSION
} from '../src/storage/fingerprint.js';

describe('Deterministic Normalization & Fingerprinting (src/storage/fingerprint.js)', () => {
  test('identical errors produce identical fingerprints', () => {
    const err1 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'Error: Cannot find module "express"'
    });

    const err2 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'Error: Cannot find module "express"'
    });

    assert.equal(err1.fingerprint, err2.fingerprint);
  });

  test('timestamp differences produce identical fingerprints', () => {
    const err1 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: '2026-08-29T07:51:51.688Z [error] Failed to connect to Redis at 10.0.0.1:6379'
    });

    const err2 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: '2026-11-15T19:04:12.100Z [error] Failed to connect to Redis at 10.0.0.1:6379'
    });

    assert.equal(err1.fingerprint, err2.fingerprint);
    assert.equal(err1.normalizedError, err2.normalizedError);
    assert.ok(err1.normalizedError.includes('<TIMESTAMP>'));
  });

  test('Process ID (PID) differences produce identical fingerprints', () => {
    const err1 = computeFingerprint({
      command: 'node',
      args: ['server.js'],
      exitCode: 1,
      stderr: 'FATAL: [pid 4891] Unhandled rejection: DB pool closed (pid=4891)'
    });

    const err2 = computeFingerprint({
      command: 'node',
      args: ['server.js'],
      exitCode: 1,
      stderr: 'FATAL: [pid 91024] Unhandled rejection: DB pool closed (pid=91024)'
    });

    assert.equal(err1.fingerprint, err2.fingerprint);
    assert.equal(err1.normalizedError, err2.normalizedError);
  });

  test('temporary path differences produce identical fingerprints', () => {
    const err1 = computeFingerprint({
      command: 'jest',
      args: ['test/auth.test.js'],
      exitCode: 1,
      stderr: 'FAIL in C:\\Users\\tejas\\AppData\\Local\\Temp\\build-xyz\\auth.test.js'
    });

    const err2 = computeFingerprint({
      command: 'jest',
      args: ['test/auth.test.js'],
      exitCode: 1,
      stderr: 'FAIL in C:\\Users\\tejas\\AppData\\Local\\Temp\\build-999abc\\auth.test.js'
    });

    assert.equal(err1.fingerprint, err2.fingerprint);
    assert.equal(err1.normalizedError, err2.normalizedError);
    assert.ok(err1.normalizedError.includes('<TEMP_PATH>'));
  });

  test('Unix temporary path differences produce identical fingerprints', () => {
    const err1 = computeFingerprint({
      command: 'pytest',
      args: ['tests/'],
      exitCode: 1,
      stderr: 'File "/tmp/pytest-of-runner/pytest-0/test_app.py", line 42, in test_login'
    });

    const err2 = computeFingerprint({
      command: 'pytest',
      args: ['tests/'],
      exitCode: 1,
      stderr: 'File "/tmp/pytest-of-ci/pytest-88/test_app.py", line 42, in test_login'
    });

    assert.equal(err1.fingerprint, err2.fingerprint);
    assert.equal(err1.normalizedError, err2.normalizedError);
  });

  test('UUID / GUID differences produce identical fingerprints', () => {
    const err1 = computeFingerprint({
      command: 'cargo',
      args: ['test'],
      exitCode: 101,
      stderr: 'thread panicked at "Transaction e4b6c890-55aa-42ec-a945-5fd21dec0538 failed"'
    });

    const err2 = computeFingerprint({
      command: 'cargo',
      args: ['test'],
      exitCode: 101,
      stderr: 'thread panicked at "Transaction 11223344-5566-4788-9900-aabbccddeeff failed"'
    });

    assert.equal(err1.fingerprint, err2.fingerprint);
    assert.equal(err1.normalizedError, err2.normalizedError);
    assert.ok(err1.normalizedError.includes('<UUID>'));
  });

  test('memory address & hex pointer differences produce identical fingerprints', () => {
    const err1 = computeFingerprint({
      command: 'go',
      args: ['test'],
      exitCode: 2,
      stderr: 'panic: runtime error: invalid memory address or nil pointer dereference [signal SIGSEGV: code=0x1 addr=0x7ffeefbff560 pc=0x4097f2]'
    });

    const err2 = computeFingerprint({
      command: 'go',
      args: ['test'],
      exitCode: 2,
      stderr: 'panic: runtime error: invalid memory address or nil pointer dereference [signal SIGSEGV: code=0x1 addr=0x7ffeefbff990 pc=0x4097f2]'
    });

    assert.equal(err1.fingerprint, err2.fingerprint);
    assert.equal(err1.normalizedError, err2.normalizedError);
  });

  test('execution duration & timer differences produce identical fingerprints', () => {
    const err1 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'Tests failed (took 142ms) with 1 failure'
    });

    const err2 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'Tests failed (took 890ms) with 1 failure'
    });

    assert.equal(err1.fingerprint, err2.fingerprint);
    assert.equal(err1.normalizedError, err2.normalizedError);
  });

  test('materially meaningful error differences produce DIFFERENT fingerprints', () => {
    const errConn = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'Error: connect ECONNREFUSED 127.0.0.1:5432'
    });

    const errTimeout = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'Error: connect ETIMEDOUT 127.0.0.1:5432'
    });

    const errHttp404 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'HTTP 404 Not Found: /api/v1/users'
    });

    const errHttp500 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'HTTP 500 Internal Server Error: /api/v1/users'
    });

    assert.notEqual(errConn.fingerprint, errTimeout.fingerprint);
    assert.notEqual(errHttp404.fingerprint, errHttp500.fingerprint);
    assert.notEqual(errConn.fingerprint, errHttp404.fingerprint);
  });

  test('different commands produce DIFFERENT fingerprints', () => {
    const errNpm = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'SyntaxError: Unexpected token'
    });

    const errYarn = computeFingerprint({
      command: 'yarn',
      args: ['test'],
      exitCode: 1,
      stderr: 'SyntaxError: Unexpected token'
    });

    assert.notEqual(errNpm.fingerprint, errYarn.fingerprint);
  });

  test('different exit codes produce DIFFERENT fingerprints', () => {
    const errCode1 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 1,
      stderr: 'Command failed'
    });

    const errCode2 = computeFingerprint({
      command: 'npm',
      args: ['test'],
      exitCode: 2,
      stderr: 'Command failed'
    });

    assert.notEqual(errCode1.fingerprint, errCode2.fingerprint);
  });

  test('handles empty stderr and stdout gracefully', () => {
    const res = computeFingerprint({
      command: 'false',
      args: [],
      exitCode: 1,
      stderr: '',
      stdout: ''
    });

    assert.ok(res.fingerprint);
    assert.equal(res.fingerprint.length, 64);
    assert.equal(res.fingerprintVersion, 2);
    assert.equal(res.normalizedError, '');
  });

  test('v2 default produces 64-hex full SHA-256 with exact 16-hex prefix matching legacy v1', () => {
    const failureParams = {
      command: 'node',
      args: ['app.js'],
      exitCode: 1,
      stderr: 'TypeError: Cannot read properties of undefined (reading "id")'
    };

    const v2 = computeFingerprint(failureParams);
    const v1 = computeLegacyFingerprint(failureParams);

    assert.equal(v2.fingerprintVersion, 2);
    assert.equal(v2.fingerprint.length, 64);
    assert.match(v2.fingerprint, /^[0-9a-f]{64}$/);

    assert.equal(v1.fingerprintVersion, 1);
    assert.equal(v1.fingerprint.length, 16);
    assert.match(v1.fingerprint, /^[0-9a-f]{16}$/);

    // Mathematical invariant: v1 is identically the first 16 characters of v2
    assert.equal(v2.fingerprint.slice(0, 16), v1.fingerprint);
    assert.equal(v2.legacyFingerprint, v1.fingerprint);
  });

  test('fingerprintsMatch handles exact matches and cross-version prefix matching', () => {
    const failureParams = {
      command: 'npm',
      args: ['run', 'build'],
      exitCode: 1,
      stderr: 'RollupError: Could not resolve entry module'
    };

    const v2 = computeFingerprint(failureParams);
    const v1 = computeLegacyFingerprint(failureParams);

    // Exact matches
    assert.equal(fingerprintsMatch(v2.fingerprint, v2.fingerprint), true);
    assert.equal(fingerprintsMatch(v1.fingerprint, v1.fingerprint), true);

    // Cross-version matches
    assert.equal(fingerprintsMatch(v2.fingerprint, v1.fingerprint), true);
    assert.equal(fingerprintsMatch(v1.fingerprint, v2.fingerprint), true);

    // Mismatches
    const different = computeFingerprint({ command: 'git', exitCode: 1, stderr: 'fatal: error' });
    assert.equal(fingerprintsMatch(v2.fingerprint, different.fingerprint), false);
    assert.equal(fingerprintsMatch(v1.fingerprint, different.fingerprint), false);

    // Edge cases
    assert.equal(fingerprintsMatch(null, v2.fingerprint), false);
    assert.equal(fingerprintsMatch('', v2.fingerprint), false);
    assert.equal(fingerprintsMatch('short', v2.fingerprint), false);
  });

  test('formatShortFingerprint formats fingerprints safely for UI presentation', () => {
    const fp64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    assert.equal(formatShortFingerprint(fp64), '0123456789ab…');
    assert.equal(formatShortFingerprint(fp64, 8), '01234567…');
    assert.equal(formatShortFingerprint(fp64, 64), fp64);
    assert.equal(formatShortFingerprint('short', 12), 'short');
    assert.equal(formatShortFingerprint(null), '');
    assert.equal(formatShortFingerprint(undefined), '');
  });

  test('inferFingerprintVersion strictly enforces digest length invariants', () => {
    const fp64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const fp16 = '0123456789abcdef';

    // 64-hex string is always v2
    assert.equal(inferFingerprintVersion(fp64), 2);
    assert.equal(inferFingerprintVersion(fp64, 1), 2); // Invariant overrides mismatched explicit version
    assert.equal(inferFingerprintVersion(fp64, 2), 2);

    // 16-hex string is always v1
    assert.equal(inferFingerprintVersion(fp16), 1);
    assert.equal(inferFingerprintVersion(fp16, 2), 1); // Invariant overrides mismatched explicit version
    assert.equal(inferFingerprintVersion(fp16, 1), 1);

    // Non-standard or missing digests fall back to explicit version or default FINGERPRINT_VERSION
    assert.equal(inferFingerprintVersion('', 1), 1);
    assert.equal(inferFingerprintVersion('', 2), 2);
    assert.equal(inferFingerprintVersion(null, 1), 1);
    assert.equal(inferFingerprintVersion(null), 2);
    assert.equal(inferFingerprintVersion('custom_fp', 1), 1);
    assert.equal(inferFingerprintVersion('custom_fp'), 2);
  });
});
