import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCLI } from '../src/cli.js';
import { ExitCodes } from '../src/errors.js';

/**
 * Helper to capture stdout/stderr in test runs.
 */
function createMockIO({ env = {}, isTTY = false } = {}) {
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
      cwd: process.cwd()
    },
    getStdout: () => stdoutData,
    getStderr: () => stderrData
  };
}

describe('CLI Integration & Behaviors (src/cli.js)', () => {
  test('rewind (no args) displays help on stdout with exit code 0', async () => {
    const { io, getStdout, getStderr } = createMockIO();
    const exitCode = await runCLI([], io);

    assert.equal(exitCode, ExitCodes.SUCCESS);
    assert.ok(getStdout().includes('REWIND — Remember what fixed it.'));
    assert.ok(getStdout().includes('USAGE:'));
    assert.equal(getStderr(), '');
  });

  test('rewind --help and -h display help on stdout with exit code 0', async () => {
    const mock1 = createMockIO();
    const code1 = await runCLI(['--help'], mock1.io);
    assert.equal(code1, ExitCodes.SUCCESS);
    assert.ok(mock1.getStdout().includes('USAGE:'));
    assert.equal(mock1.getStderr(), '');

    const mock2 = createMockIO();
    const code2 = await runCLI(['-h'], mock2.io);
    assert.equal(code2, ExitCodes.SUCCESS);
    assert.ok(mock2.getStdout().includes('USAGE:'));
    assert.equal(mock2.getStderr(), '');
  });

  test('rewind help <command> displays command-specific help on stdout with exit code 0', async () => {
    const { io, getStdout, getStderr } = createMockIO();
    const exitCode = await runCLI(['help', 'run'], io);

    assert.equal(exitCode, ExitCodes.SUCCESS);
    assert.ok(getStdout().includes('REWIND RUN'));
    assert.ok(getStdout().includes('rewind run <command...>'));
    assert.equal(getStderr(), '');
  });

  test('rewind --version and -v display version on stdout with exit code 0', async () => {
    const mock1 = createMockIO();
    const code1 = await runCLI(['--version'], mock1.io);
    assert.equal(code1, ExitCodes.SUCCESS);
    assert.equal(mock1.getStdout().trim(), 'rewind v1.0.0');
    assert.equal(mock1.getStderr(), '');

    const mock2 = createMockIO();
    const code2 = await runCLI(['-v'], mock2.io);
    assert.equal(code2, ExitCodes.SUCCESS);
    assert.equal(mock2.getStdout().trim(), 'rewind v1.0.0');
    assert.equal(mock2.getStderr(), '');
  });

  test('rewind --version --json outputs valid JSON version payload to stdout', async () => {
    const { io, getStdout, getStderr } = createMockIO();
    const exitCode = await runCLI(['--version', '--json'], io);

    assert.equal(exitCode, ExitCodes.SUCCESS);
    const parsed = JSON.parse(getStdout().trim());
    assert.deepEqual(parsed, { name: 'rewind', version: '1.0.0' });
    assert.equal(getStderr(), '');
  });

  test('unknown command returns exit code 2 and writes error to stderr', async () => {
    const { io, getStdout, getStderr } = createMockIO();
    const exitCode = await runCLI(['unknown-subcommand'], io);

    assert.equal(exitCode, ExitCodes.USAGE_ERROR);
    assert.equal(getStdout(), '');
    assert.ok(getStderr().includes('Unknown command: "unknown-subcommand"'));
  });

  test('unknown option returns exit code 2 and writes error to stderr', async () => {
    const { io, getStdout, getStderr } = createMockIO();
    const exitCode = await runCLI(['--invalid-flag'], io);

    assert.equal(exitCode, ExitCodes.USAGE_ERROR);
    assert.equal(getStdout(), '');
    assert.ok(getStderr().includes('Unknown option: "--invalid-flag"'));
  });

  test('missing required arguments return exit code 2 and usage hints on stderr', async () => {
    // rewind run (missing command)
    const runMock = createMockIO();
    const runCode = await runCLI(['run'], runMock.io);
    assert.equal(runCode, ExitCodes.USAGE_ERROR);
    assert.ok(runMock.getStderr().includes('Missing required argument <command>'));

    // rewind show (missing id)
    const showMock = createMockIO();
    const showCode = await runCLI(['show'], showMock.io);
    assert.equal(showCode, ExitCodes.USAGE_ERROR);
    assert.ok(showMock.getStderr().includes('Missing required argument <id>'));

    // rewind recover (missing id)
    const recoverMock = createMockIO();
    const recoverCode = await runCLI(['recover'], recoverMock.io);
    assert.equal(recoverCode, ExitCodes.USAGE_ERROR);
    assert.ok(recoverMock.getStderr().includes('Missing required argument <id>'));

    // rewind verify (missing id)
    const verifyMock = createMockIO();
    const verifyCode = await runCLI(['verify'], verifyMock.io);
    assert.equal(verifyCode, ExitCodes.USAGE_ERROR);
    assert.ok(verifyMock.getStderr().includes('Missing required argument <id>'));
  });

  test('rewind run propagates exit code 0 for successful command', async () => {
    const { io, getStdout, getStderr } = createMockIO();
    const exitCode = await runCLI(['run', process.execPath, '-e', 'console.log("pass")'], io);

    assert.equal(exitCode, 0);
    assert.ok(getStdout().includes('pass'));
    assert.equal(getStderr(), '');
  });

  test('rewind run propagates non-zero exit code for failing command', async () => {
    const { io, getStdout, getStderr } = createMockIO();
    const exitCode = await runCLI(['run', process.execPath, '-e', 'console.error("fail"); process.exit(19)'], io);

    assert.equal(exitCode, 19);
    assert.ok(getStderr().includes('fail'));
  });

  test('rewind run --json outputs full capture record in machine-readable JSON', async () => {
    const { io, getStdout } = createMockIO();
    const exitCode = await runCLI(['--json', 'run', process.execPath, '-e', 'console.log("captured in json")'], io);

    assert.equal(exitCode, 0);
    const parsed = JSON.parse(getStdout().trim());
    assert.equal(parsed.status, 'success');
    assert.equal(parsed.data.exitCode, 0);
    assert.ok(parsed.data.stdout.includes('captured in json'));
    assert.ok(parsed.data.git);
    assert.ok(parsed.data.environment);
  });

  test('JSON error mode formats error payload as valid JSON on stdout', async () => {
    const { io, getStdout, getStderr } = createMockIO();
    const exitCode = await runCLI(['unknown-subcommand', '--json'], io);

    assert.equal(exitCode, ExitCodes.USAGE_ERROR);
    assert.equal(getStderr(), ''); // No raw text on stderr in JSON mode
    const parsed = JSON.parse(getStdout().trim());
    assert.equal(parsed.status, 'error');
    assert.equal(parsed.error.code, 'ERR_UNKNOWN_COMMAND');
    assert.equal(parsed.error.exitCode, ExitCodes.USAGE_ERROR);
  });

  test('NO_COLOR environment variable disables ANSI escape codes in output', async () => {
    const { io, getStderr } = createMockIO({
      env: { NO_COLOR: '1' },
      isTTY: true
    });
    const exitCode = await runCLI(['invalid-cmd'], io);
    assert.equal(exitCode, ExitCodes.USAGE_ERROR);
    // Ensure no ANSI escape character \x1b is present
    assert.ok(!getStderr().includes('\x1b'));
  });

  test('non-TTY mode disables ANSI escape codes', async () => {
    const { io, getStderr } = createMockIO({
      env: {},
      isTTY: false
    });
    const exitCode = await runCLI(['invalid-cmd'], io);
    assert.equal(exitCode, ExitCodes.USAGE_ERROR);
    assert.ok(!getStderr().includes('\x1b'));
  });

  test('rewind run executes compound shell commands with && operator', async () => {
    const { io, getStdout, getStderr } = createMockIO();
    const compoundCmd = `"${process.execPath}" -e "process.stdout.write('part1-')"` + ' && ' + `"${process.execPath}" -e "process.stdout.write('part2')"`;
    const exitCode = await runCLI(['run', compoundCmd], io);

    assert.equal(exitCode, 0);
    assert.ok(getStdout().includes('part1-part2'));
    assert.equal(getStderr(), '');
  });

  test('rewind run accepts --shell flag placed before or after run subcommand', async () => {
    const mock1 = createMockIO();
    const code1 = await runCLI(['--shell', 'run', `"${process.execPath}" -e "console.log('shell_prefix')"`], mock1.io);
    assert.equal(code1, 0);
    assert.ok(mock1.getStdout().includes('shell_prefix'));

    const mock2 = createMockIO();
    const code2 = await runCLI(['run', '--shell', `"${process.execPath}" -e "console.log('shell_postfix')"`], mock2.io);
    assert.equal(code2, 0);
    assert.ok(mock2.getStdout().includes('shell_postfix'));
  });

  test('rewind run tolerates storage persistence failure and preserves child exit code', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-failstore-test-'));
    try {
      const ledgerPath = path.join(tmpDir, '.rewind');
      fs.mkdirSync(ledgerPath, { recursive: true });
      // Corrupt journal.jsonl by creating it as a directory so init succeeds but appendJournalEvent / write fails
      fs.mkdirSync(path.join(ledgerPath, 'journal.jsonl'), { recursive: true });

      const mock = createMockIO({ cwd: tmpDir });
      const exitCode = await runCLI(['--root', tmpDir, 'run', process.execPath, '-e', 'console.error("child_err_19"); process.exit(19);'], mock.io);

      assert.equal(exitCode, 19);
      assert.ok(mock.getStderr().includes('child_err_19'));
      assert.ok(mock.getStderr().includes('[rewind:warning]'));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
