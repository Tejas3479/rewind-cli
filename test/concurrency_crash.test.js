import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StorageEngine } from '../src/storage/store.js';
import { boundOutput } from '../src/storage/record.js';

describe('Concurrency, Crash & Stream Bounds (src/storage/store.js & record.js)', () => {
  test('bounds enormous log streams to head + tail and preserves cryptographic evidenceHash', () => {
    // Generate 200 KB string with distinct markers at head and tail
    const largeText = 'STARTING CRITICAL TASK\n' + 'A'.repeat(100 * 1024) + '\nFINAL CRITICAL FAILURE AT TAIL';
    const { bounded, hash, truncated } = boundOutput(largeText);

    assert.equal(truncated, true);
    assert.ok(bounded.length < largeText.length);
    assert.match(bounded, /STARTING CRITICAL TASK/);
    assert.match(bounded, /omitted; full output SHA-256:/);
    assert.match(bounded, /FINAL CRITICAL FAILURE AT TAIL/);
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 64);
  });

  test('cleans orphaned .tmp files on StorageEngine initialization after interrupted write', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-crash-test-'));
    try {
      const storage = new StorageEngine(tmpDir).init();

      // Simulate an aborted temporary write left behind by a crash
      const orphanPath = path.join(tmpDir, 'tmp', 'crash_orphan.tmp');
      fs.writeFileSync(orphanPath, 'partial write content');
      assert.equal(fs.existsSync(orphanPath), true);

      // Re-initialize storage engine (like startup on next CLI run)
      const freshStorage = new StorageEngine(tmpDir).init();

      // Verify orphaned tmp file was cleaned up
      assert.equal(fs.existsSync(orphanPath), false);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('serializes sequential and rapid atomic writes without index corruption', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-concurrency-test-'));
    try {
      const storage = new StorageEngine(tmpDir).init();

      for (let i = 1; i <= 20; i++) {
        storage.saveRecord({
          command: 'node',
          args: [`job-${i}.js`],
          fullCommand: `node job-${i}.js`,
          cwd: tmpDir,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 10,
          exitCode: 1,
          signal: null,
          success: false,
          stdout: '',
          stderr: `Job ${i} failed`,
          git: { isGit: false },
          environment: { platform: 'win32', nodeVersion: 'v22.0.0' }
        });
      }

      const { records: all } = storage.listRecords();
      assert.equal(all.length, 20);

      // Verify IDs are strictly ordered 1 through 20
      for (let i = 0; i < 20; i++) {
        assert.equal(all[i].id, String(i + 1));
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('allocates unique non-colliding IDs when multiple storage instances write to same ledger', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-concurrent-instances-'));
    try {
      const storageA = new StorageEngine(tmpDir).init();
      const storageB = new StorageEngine(tmpDir).init();

      // Alternating writes between two independent storage engine handles
      const recA1 = storageA.saveRecord({
        command: 'npm',
        args: ['test'],
        exitCode: 1,
        stderr: 'Error from A1',
        cwd: tmpDir
      });

      const recB1 = storageB.saveRecord({
        command: 'npm',
        args: ['test'],
        exitCode: 1,
        stderr: 'Error from B1',
        cwd: tmpDir
      });

      const recA2 = storageA.saveRecord({
        command: 'npm',
        args: ['test'],
        exitCode: 1,
        stderr: 'Error from A2',
        cwd: tmpDir
      });

      assert.equal(recA1.id, '1');
      assert.equal(recB1.id, '2');
      assert.equal(recA2.id, '3');

      storageA.close();
      storageB.close();
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
