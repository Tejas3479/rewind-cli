import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
import { StorageEngine } from '../src/storage/store.js';
import { IncidentStatus, RecoveryAttemptStatus } from '../src/storage/state.js';
import {
  getBashHook,
  getZshHook,
  getPowerShellHook,
  getInstallationOverview,
  normalizeShellName
} from '../src/hooks/templates.js';
import { runCLI } from '../src/cli.js';
import { createStyler } from '../src/formatter.js';
import { stripAnsi } from '../src/sanitizer.js';

function createMockIO({ stdinLines = [], isTTY = true } = {}) {
  let stdoutData = '';
  let stderrData = '';

  const stdout = new Writable({
    write(chunk, encoding, callback) {
      stdoutData += chunk.toString();
      callback();
    }
  });
  stdout.isTTY = isTTY;

  const stderr = new Writable({
    write(chunk, encoding, callback) {
      stderrData += chunk.toString();
      callback();
    }
  });
  stderr.isTTY = isTTY;

  const stdin = new PassThrough();
  stdin.isTTY = isTTY;

  return {
    stdin,
    stdout,
    stderr,
    getStdout: () => stdoutData,
    getStderr: () => stderrData
  };
}

describe('Optional REWIND Shell-Hook Integrations (test/hook.test.js)', () => {
  let tempDir;
  let storage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-hook-test-'));
    storage = new StorageEngine(path.join(tempDir, '.rewind'));
    storage.init();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Shell Script Templates & Normalization', () => {
    test('normalizes shell aliases correctly', () => {
      assert.equal(normalizeShellName('bash'), 'bash');
      assert.equal(normalizeShellName('BASH'), 'bash');
      assert.equal(normalizeShellName('zsh'), 'zsh');
      assert.equal(normalizeShellName('powershell'), 'powershell');
      assert.equal(normalizeShellName('pwsh'), 'powershell');
      assert.equal(normalizeShellName('ps'), 'powershell');
      assert.equal(normalizeShellName('fish'), null);
      assert.equal(normalizeShellName(''), null);
    });

    test('getBashHook generates valid bash script with non-interactive guard and exit code restoration', () => {
      const script = getBashHook();
      assert.match(script, /eval "\$\(rewind hook bash\)"/);
      assert.match(script, /if \[\[ \$- == \*i\* \]\]; then/);
      assert.match(script, /PROMPT_COMMAND/);
      assert.match(script, /_rewind_preexec/);
      assert.match(script, /_rewind_prompt/);
      assert.match(script, /return \$_rewind_exit/);
    });

    test('getZshHook generates valid zsh script with add-zsh-hook and exit code restoration', () => {
      const script = getZshHook();
      assert.match(script, /eval "\$\(rewind hook zsh\)"/);
      assert.match(script, /if \[\[ -o interactive \]\]; then/);
      assert.match(script, /add-zsh-hook preexec _rewind_preexec/);
      assert.match(script, /add-zsh-hook precmd _rewind_precmd/);
      assert.match(script, /return \$_rewind_exit/);
    });

    test('getPowerShellHook generates valid PowerShell script with LASTEXITCODE restoration', () => {
      const script = getPowerShellHook();
      assert.match(script, /Invoke-Expression \(& rewind hook powershell \| Out-String\)/);
      assert.match(script, /function global:prompt/);
      assert.match(script, /\$origLastExit = \$global:LASTEXITCODE/);
      assert.match(script, /\$global:LASTEXITCODE = \$origLastExit/);
    });

    test('getInstallationOverview formats comprehensive setup guide', () => {
      const s = createStyler(false);
      const overview = getInstallationOverview(s);
      assert.match(overview, /REWIND SHELL HOOKS/);
      assert.match(overview, /eval "\$\(rewind hook bash\)"/);
      assert.match(overview, /eval "\$\(rewind hook zsh\)"/);
      assert.match(overview, /Invoke-Expression/);
    });
  });

  describe('CLI Command Dispatch (rewind hook)', () => {
    test('rewind hook without args displays installation overview', async () => {
      const { stdin, stdout, stderr, getStdout } = createMockIO();

      const exitCode = await runCLI(['hook'], {
        stdin,
        stdout,
        stderr,
        isTTY: false
      });

      assert.equal(exitCode, 0);
      const out = stripAnsi(getStdout());
      assert.match(out, /REWIND SHELL HOOKS/);
      assert.match(out, /SUPPORTED SHELLS/);
    });

    test('rewind hook bash outputs bash script', async () => {
      const { stdin, stdout, stderr, getStdout } = createMockIO();

      const exitCode = await runCLI(['hook', 'bash'], {
        stdin,
        stdout,
        stderr,
        isTTY: false
      });

      assert.equal(exitCode, 0);
      const out = getStdout();
      assert.match(out, /# REWIND Shell Integration for Bash/);
      assert.match(out, /_rewind_prompt/);
    });

    test('rewind hook zsh outputs zsh script', async () => {
      const { stdin, stdout, stderr, getStdout } = createMockIO();

      const exitCode = await runCLI(['hook', 'zsh'], {
        stdin,
        stdout,
        stderr,
        isTTY: false
      });

      assert.equal(exitCode, 0);
      const out = getStdout();
      assert.match(out, /# REWIND Shell Integration for Zsh/);
      assert.match(out, /_rewind_precmd/);
    });

    test('rewind hook powershell outputs PowerShell script', async () => {
      const { stdin, stdout, stderr, getStdout } = createMockIO();

      const exitCode = await runCLI(['hook', 'powershell'], {
        stdin,
        stdout,
        stderr,
        isTTY: false
      });

      assert.equal(exitCode, 0);
      const out = getStdout();
      assert.match(out, /# REWIND Shell Integration for PowerShell/);
      assert.match(out, /\$global:LASTEXITCODE = \$origLastExit/);
    });

    test('rewind hook rejects unsupported shell with InvalidArgumentError', async () => {
      const { stdin, stdout, stderr, getStderr } = createMockIO();

      const exitCode = await runCLI(['hook', 'invalid_shell'], {
        stdin,
        stdout,
        stderr,
        isTTY: false
      });

      assert.equal(exitCode, 2);
      const errOut = getStderr();
      assert.match(errOut, /Unsupported shell: "invalid_shell"/);
    });
  });

  describe('Passive Hook Recording (rewind hook record)', () => {
    test('ignores exit 0 without writing any incident record', async () => {
      const { stdin, stdout, stderr, getStderr } = createMockIO();

      const exitCode = await runCLI(['hook', 'record', '--exit', '0', '--cmd', 'npm test', '--root', tempDir], {
        stdin,
        stdout,
        stderr,
        isTTY: false
      });

      assert.equal(exitCode, 0);
      assert.equal(getStderr(), '');

      storage.rebuildIndex();
      const { records } = storage.listRecords();
      assert.equal(records.length, 0);
    });

    test('records failed command (exit 1) into ledger with diagnostic and prints concise notification', async () => {
      const { stdin, stdout, stderr, getStderr } = createMockIO();

      const exitCode = await runCLI([
        'hook',
        'record',
        '--exit',
        '1',
        '--cmd',
        'npm test',
        '--duration',
        '150',
        '--stderr',
        'TypeError: Cannot read properties of undefined\n    at index.js:10:5',
        '--root',
        tempDir
      ], {
        stdin,
        stdout,
        stderr,
        isTTY: false
      });

      assert.equal(exitCode, 0);
      const errOut = stripAnsi(getStderr());

      assert.match(errOut, /Failure recorded as incident #1\./);
      assert.match(errOut, /Run: rewind triage 1/);

      storage.rebuildIndex();
      const record = storage.getRecord('1');
      assert.ok(record);
      assert.equal(record.command, 'npm');
      assert.deepEqual(record.args, ['test']);
      assert.equal(record.exitCode, 1);
      assert.equal(record.durationMs, 150);
      assert.equal(record.status, IncidentStatus.OBSERVED);
      assert.ok(record.diagnostic);
      assert.equal(record.diagnostic.errorType, 'TypeError');
    });

    test('applies secret redaction to recorded command and arguments', async () => {
      const { stdin, stdout, stderr } = createMockIO();

      const secretCmd = 'curl -H "Authorization: Bearer sk-abcdef1234567890abcdef1234" https://api.example.com';
      await runCLI([
        'hook',
        'record',
        '--exit',
        '2',
        '--cmd',
        secretCmd,
        '--root',
        tempDir
      ], {
        stdin,
        stdout,
        stderr,
        isTTY: false
      });

      storage.rebuildIndex();
      const record = storage.getRecord('1');
      assert.ok(record);
      assert.doesNotMatch(record.fullCommand, /sk-abcdef/);
      assert.match(record.fullCommand, /\[REDACTED_API_KEY\]/);
    });

    test('detects regression when failure matches a previously verified incident', async () => {
      // Create initial incident #1 and mark verified
      const initRecord = storage.saveRecord({
        command: 'npm',
        args: ['test'],
        fullCommand: 'npm test',
        exitCode: 1,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 50,
        stderr: 'FATAL: database port 5432 closed',
        cwd: tempDir
      });

      storage.addRecoveryAttempt(initRecord.id, {
        cause: 'DB service stopped',
        change: 'Started DB service',
        verifyCmd: 'npm test'
      });
      storage.recordVerificationRun(initRecord.id, 1, {
        command: 'npm test',
        exitCode: 0,
        durationMs: 40,
        output: 'DB connected: ok'
      });

      // Hook records the same failure again
      const { stdin, stdout, stderr, getStderr } = createMockIO();
      await runCLI([
        'hook',
        'record',
        '--exit',
        '1',
        '--cmd',
        'npm test',
        '--stderr',
        'FATAL: database port 5432 closed',
        '--root',
        tempDir
      ], {
        stdin,
        stdout,
        stderr,
        isTTY: false
      });

      const errOut = stripAnsi(getStderr());
      assert.match(errOut, /REGRESSION of verified #1/);
    });
  });

  describe('Live PowerShell Exit Code Invariant Verification', () => {
    test('verifies PowerShell hook preserves $LASTEXITCODE under exit 0, exit 42, and error tolerance', () => {
      if (process.platform !== 'win32') {
        // Skip Windows-only live PowerShell test on POSIX
        return;
      }

      const hookScript = getPowerShellHook();
      const testPs1Path = path.join(tempDir, 'test_ps_hook.ps1');

      const psScript = `
        $ErrorActionPreference = 'Continue'
        ${hookScript}

        # 1. Success command
        node -e "process.exit(0)"
        prompt > $null
        $exitAfterSuccess = $global:LASTEXITCODE

        # 2. Failure command
        node -e "process.exit(42)"
        prompt > $null
        $exitAfterFailure = $global:LASTEXITCODE

        # Output results
        Write-Output "SUCCESS_EXIT:$exitAfterSuccess"
        Write-Output "FAILURE_EXIT:$exitAfterFailure"

        if ($exitAfterFailure -ne 42) {
            exit 99
        }
        exit 0
      `;

      fs.writeFileSync(testPs1Path, psScript, 'utf8');

      const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', testPs1Path], {
        encoding: 'utf8'
      });

      assert.equal(res.status, 0, `PowerShell script failed with output: ${res.stdout}\n${res.stderr}`);
      assert.match(res.stdout, /SUCCESS_EXIT:0/);
      assert.match(res.stdout, /FAILURE_EXIT:42/);
    });
  });

  describe('NO_COLOR Compliance', () => {
    test('hook record notification respects --no-color flag without ANSI escapes', async () => {
      const { stdin, stdout, stderr, getStderr } = createMockIO();

      await runCLI([
        'hook',
        'record',
        '--no-color',
        '--exit',
        '1',
        '--cmd',
        'pytest test_auth.py',
        '--root',
        tempDir
      ], {
        stdin,
        stdout,
        stderr,
        isTTY: false,
        noColorFlag: true
      });

      const errOut = getStderr();
      assert.doesNotMatch(errOut, /\x1b\[[0-9;]*m/);
      assert.match(errOut, /\[rewind\] Failure recorded as incident #1\./);
      assert.match(errOut, /\[rewind\] Run: rewind triage 1/);
    });
  });
});
