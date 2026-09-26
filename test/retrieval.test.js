import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { runCLI } from '../src/cli.js';

function createMockIO({ env = {}, isTTY = false, cwd = process.cwd() } = {}) {
  let stdoutData = '';
  let stderrData = '';

  const stdout = {
    write: (chunk) => {
      stdoutData += chunk;
      return true;
    }
  };

  const stderr = {
    write: (chunk) => {
      stderrData += chunk;
      return true;
    }
  };

  return {
    io: {
      stdout,
      stderr,
      stdin: {},
      env,
      isTTY,
      cwd
    },
    getStdout: () => stdoutData,
    getStderr: () => stderrData
  };
}

describe('Historical Retrieval: history & show (src/commands/history.js & show.js)', () => {
  test('history on empty ledger displays friendly notice on stdout', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-empty-hist-'));
    try {
      const rootFlag = `--root=${tmpDir}`;
      const mock = createMockIO({ cwd: tmpDir });
      const code = await runCLI([rootFlag, 'history'], mock.io);

      assert.equal(code, 0);
      assert.ok(mock.getStdout().includes('No recorded incidents in ledger'));
      assert.equal(mock.getStderr(), '');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('history --json on empty ledger returns clean empty JSON payload', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-empty-json-'));
    try {
      const rootFlag = `--root=${tmpDir}`;
      const mock = createMockIO({ cwd: tmpDir });
      const code = await runCLI([rootFlag, 'history', '--json'], mock.io);

      assert.equal(code, 0);
      assert.equal(mock.getStderr(), '');

      const parsed = JSON.parse(mock.getStdout().trim());
      assert.equal(parsed.status, 'success');
      assert.equal(parsed.total, 0);
      assert.equal(parsed.count, 0);
      assert.deepEqual(parsed.data, []);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('history displays incidents sorted newest first', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-hist-order-'));
    try {
      const rootFlag = `--root=${tmpDir}`;

      // Create 3 incidents
      const mock1 = createMockIO({ cwd: tmpDir });
      await runCLI([rootFlag, 'run', process.execPath, '-e', 'console.error("Failure 1"); process.exit(1);'], mock1.io);

      const mock2 = createMockIO({ cwd: tmpDir });
      await runCLI([rootFlag, 'run', process.execPath, '-e', 'console.error("Failure 2"); process.exit(2);'], mock2.io);

      const mock3 = createMockIO({ cwd: tmpDir });
      await runCLI([rootFlag, 'run', process.execPath, '-e', 'console.error("Failure 3"); process.exit(3);'], mock3.io);

      // List history
      const mockHist = createMockIO({ cwd: tmpDir });
      const code = await runCLI([rootFlag, 'history'], mockHist.io);

      assert.equal(code, 0);
      const out = mockHist.getStdout();
      assert.ok(out.includes('#3'));
      assert.ok(out.includes('#2'));
      assert.ok(out.includes('#1'));

      // Newest (#3) should appear before #1 in output
      const idx3 = out.indexOf('#3');
      const idx1 = out.indexOf('#1');
      assert.ok(idx3 < idx1, '#3 should appear before #1 in newest-first ordering');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('history --limit N limits the number of returned incidents', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-limit-test-'));
    try {
      const rootFlag = `--root=${tmpDir}`;

      for (let i = 1; i <= 5; i++) {
        const mock = createMockIO({ cwd: tmpDir });
        await runCLI([rootFlag, 'run', process.execPath, '-e', `console.error("Fail ${i}"); process.exit(1);`], mock.io);
      }

      // Query with --limit 2
      const mockLimit = createMockIO({ cwd: tmpDir });
      const code = await runCLI([rootFlag, 'history', '--limit', '2'], mockLimit.io);

      assert.equal(code, 0);
      const out = mockLimit.getStdout();
      assert.ok(out.includes('Showing 1-2 of 5 incidents.'));
      assert.ok(out.includes('#5'));
      assert.ok(out.includes('#4'));
      assert.ok(!out.includes('#1'));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('history --json returns clean structured JSON without chatter', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-hist-json-'));
    try {
      const rootFlag = `--root=${tmpDir}`;

      const mockRun = createMockIO({ cwd: tmpDir });
      await runCLI([rootFlag, 'run', process.execPath, '-e', 'console.error("JSON history item"); process.exit(1);'], mockRun.io);

      const mockHist = createMockIO({ cwd: tmpDir });
      const code = await runCLI([rootFlag, 'history', '--json'], mockHist.io);

      assert.equal(code, 0);
      assert.equal(mockHist.getStderr(), '');

      const parsed = JSON.parse(mockHist.getStdout().trim());
      assert.equal(parsed.status, 'success');
      assert.equal(parsed.total, 1);
      assert.equal(parsed.count, 1);
      assert.equal(parsed.data[0].id, '1');
      assert.ok(parsed.data[0].fingerprint);
      assert.ok(parsed.data[0].startTime);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('show <id> outputs complete detailed diagnostic report', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-show-test-'));
    try {
      const rootFlag = `--root=${tmpDir}`;

      const mockRun = createMockIO({ cwd: tmpDir });
      await runCLI([rootFlag, 'run', process.execPath, '-e', 'console.error("Critical database outage"); process.exit(17);'], mockRun.io);

      const mockShow = createMockIO({ cwd: tmpDir });
      const code = await runCLI([rootFlag, 'show', '1'], mockShow.io);

      assert.equal(code, 0);
      const out = mockShow.getStdout();
      assert.ok(out.includes('INCIDENT #1'));
      assert.ok(out.includes('Critical database outage'));
      assert.ok(out.includes('Exit Code:    17'));
      assert.ok(out.includes('Fingerprint:'));
      assert.ok(out.includes('… (v2)'));
      assert.ok(out.includes('Normalized Signature:'));
      assert.ok(out.includes('ENVIRONMENT & REPOSITORY:'));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('show <id> --json outputs pure machine-readable JSON', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-show-json-'));
    try {
      const rootFlag = `--root=${tmpDir}`;

      const mockRun = createMockIO({ cwd: tmpDir });
      await runCLI([rootFlag, 'run', process.execPath, '-e', 'console.error("Trace error in show json"); process.exit(1);'], mockRun.io);

      const mockShow = createMockIO({ cwd: tmpDir });
      const code = await runCLI([rootFlag, 'show', '1', '--json'], mockShow.io);

      assert.equal(code, 0);
      assert.equal(mockShow.getStderr(), '');

      const parsed = JSON.parse(mockShow.getStdout().trim());
      assert.equal(parsed.status, 'success');
      assert.equal(parsed.data.id, '1');
      assert.equal(parsed.data.exitCode, 1);
      assert.ok(parsed.data.stderr.includes('Trace error in show json'));
      assert.ok(parsed.data.normalizedError);
      assert.ok(parsed.data.fingerprint);
      assert.equal(parsed.data.fingerprint.length, 64);
      assert.equal(parsed.data.fingerprintVersion, 2);
      assert.ok(parsed.data.git);
      assert.ok(parsed.data.environment);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('show with invalid/non-existent ID returns error exit code 1', async () => {
    const mock = createMockIO();
    const code = await runCLI(['show', '99999'], mock.io);

    assert.equal(code, 1);
    assert.equal(mock.getStdout(), '');
    assert.ok(mock.getStderr().includes('Incident #99999 not found in ledger'));
  });

  test('show with invalid ID in --json mode outputs JSON error on stdout', async () => {
    const mock = createMockIO();
    const code = await runCLI(['show', '99999', '--json'], mock.io);

    assert.equal(code, 1);
    assert.equal(mock.getStderr(), '');

    const parsed = JSON.parse(mock.getStdout().trim());
    assert.equal(parsed.status, 'error');
    assert.equal(parsed.error.code, 'ERR_NOT_FOUND');
    assert.ok(parsed.error.message.includes('Incident #99999 not found in ledger'));
  });
});
