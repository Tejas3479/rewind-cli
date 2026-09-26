import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { classifyCapture, CaptureClassification } from '../src/storage/capture_policy.js';
import { StorageEngine } from '../src/storage/store.js';
import { hookCommand } from '../src/commands/hook.js';
import { createStyler } from '../src/formatter.js';

describe('Capture Policy & Noise Filtering (src/storage/capture_policy.js)', () => {
  test('classifies success or zero exit code as DISCARD', () => {
    assert.equal(classifyCapture({ success: true, exitCode: 0 }), CaptureClassification.DISCARD);
    assert.equal(classifyCapture({ success: false, exitCode: 0 }), CaptureClassification.DISCARD);
  });

  test('classifies SIGINT and exit code 130 as DISCARD', () => {
    assert.equal(classifyCapture({ exitCode: 130, signal: null }), CaptureClassification.DISCARD);
    assert.equal(classifyCapture({ exitCode: 1, signal: 'SIGINT' }), CaptureClassification.DISCARD);
    assert.equal(classifyCapture({ exitCode: null, signal: 'sigint' }), CaptureClassification.DISCARD);
  });

  test('classifies SIGKILL and exit code 137 as PROMOTE', () => {
    assert.equal(classifyCapture({ exitCode: 137, signal: null }), CaptureClassification.PROMOTE);
    assert.equal(classifyCapture({ exitCode: 1, signal: 'SIGKILL' }), CaptureClassification.PROMOTE);
  });

  test('classifies any explicit rewind_run failure as PROMOTE', () => {
    const result = classifyCapture({
      command: 'echo',
      args: ['hello'],
      exitCode: 1,
      stderr: 'some error'
    }, null, 'rewind_run');

    assert.equal(result, CaptureClassification.PROMOTE);
  });

  test('classifies first-time command-not-found and ENOENT as OBSERVE in passive shell hooks', () => {
    const notFound = classifyCapture({
      command: 'bash',
      args: ['-c', 'some_unknown_cmd'],
      exitCode: 127,
      stderr: 'bash: some_unknown_cmd: command not found'
    }, null, 'shell_hook');
    assert.equal(notFound, CaptureClassification.OBSERVE);

    const enoent = classifyCapture({
      command: 'node',
      args: ['index.js'],
      exitCode: 1,
      stderr: 'ENOENT: no such file or directory'
    }, null, 'shell_hook');
    assert.equal(enoent, CaptureClassification.OBSERVE);
  });

  test('promotes recurring failure if observation exists in ledger window', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-policy-recur-'));
    let storage = null;
    try {
      storage = new StorageEngine(tmpDir).init();

      const failure = {
        command: 'curl',
        args: ['http://localhost:9999'],
        fullCommand: 'curl http://localhost:9999',
        cwd: tmpDir,
        exitCode: 7,
        stderr: 'curl: (7) Failed to connect to localhost port 9999'
      };

      // 1. First time: should be OBSERVE
      assert.equal(classifyCapture(failure, storage, 'shell_hook'), CaptureClassification.OBSERVE);

      // Save as observation
      storage.saveObservation(failure);

      // 2. Second time: should be PROMOTE because prior observation exists
      assert.equal(classifyCapture(failure, storage, 'shell_hook'), CaptureClassification.PROMOTE);
    } finally {
      if (storage) storage.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('promotes failure if an existing incident matches fingerprint in ledger', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-policy-incident-'));
    let storage = null;
    try {
      storage = new StorageEngine(tmpDir).init();

      const failure = {
        command: 'cargo',
        args: ['build'],
        fullCommand: 'cargo build',
        cwd: tmpDir,
        exitCode: 101,
        stderr: 'error[E0425]: cannot find value `x` in this scope'
      };

      // Save as full incident
      const inc = storage.saveRecord(failure);
      assert.ok(inc.id);

      // Any subsequent occurrence in shell hook should immediately PROMOTE
      assert.equal(classifyCapture(failure, storage, 'shell_hook'), CaptureClassification.PROMOTE);
    } finally {
      if (storage) storage.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('hookCommand passive recording respects 3-tier policy', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-policy-hook-'));
    let storage = null;
    try {
      storage = new StorageEngine(tmpDir).init();
      const styler = createStyler(false);

      // 1. User cancellation (exit code 130) -> DISCARD (no records, no observations)
      let stderrOut = '';
      const fakeStderr = { write: (msg) => { stderrOut += msg; } };

      await hookCommand({
        context: {
          parsedArgs: {
            command: 'hook',
            positional: ['record'],
            flags: { exit: '130', cmd: 'npm test', duration: 100 }
          },
          storage,
          config: { rootDir: tmpDir },
          env: {},
          stdout: { write: () => {} },
          stderr: fakeStderr,
          styler
        }
      });

      assert.equal(storage.listRecords().total, 0);
      assert.equal(storage.listObservations().length, 0);
      assert.equal(stderrOut, '');

      // 2. First failure -> OBSERVE (stored silently as observation, no incident created)
      stderrOut = '';
      await hookCommand({
        context: {
          parsedArgs: {
            command: 'hook',
            positional: ['record'],
            flags: { exit: '7', cmd: 'curl http://localhost:9999', duration: 200, stderr: 'curl: (7) Failed to connect' }
          },
          storage,
          config: { rootDir: tmpDir },
          env: {},
          stdout: { write: () => {} },
          stderr: fakeStderr,
          styler
        }
      });

      assert.equal(storage.listRecords().total, 0, 'No incident should be created on first passive failure');
      assert.equal(storage.listObservations().length, 1, 'Observation should be stored');
      assert.equal(stderrOut, '', 'Passive observation should be completely silent');

      // 3. Second failure of the same command -> PROMOTE (promoted to full incident)
      stderrOut = '';
      await hookCommand({
        context: {
          parsedArgs: {
            command: 'hook',
            positional: ['record'],
            flags: { exit: '7', cmd: 'curl http://localhost:9999', duration: 210, stderr: 'curl: (7) Failed to connect' }
          },
          storage,
          config: { rootDir: tmpDir },
          env: {},
          stdout: { write: () => {} },
          stderr: fakeStderr,
          styler
        }
      });

      assert.equal(storage.listRecords().total, 1, 'Recurrent failure promoted to incident');
      assert.ok(stderrOut.includes('Failure recorded as incident #1'));
    } finally {
      if (storage) storage.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
