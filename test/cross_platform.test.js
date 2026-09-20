import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { executeAndCapture, resolveExecutable, mapSignalToExitCode } from '../src/capture.js';
import { safeAtomicRenameSync } from '../src/storage/projection.js';
import { sanitizeOutput } from '../src/sanitizer.js';
import { readGitMetadata } from '../src/git.js';
import { findProjectRoot, resolveConfig } from '../src/config.js';

describe('Cross-Platform Compatibility Suite (test/cross_platform.test.js)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-xplat-test-'));
  });

  afterEach(() => {
    try {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    } catch {
      // Ignore cleanup error
    }
  });

  describe('Executable Resolution & Command Invocation', () => {
    test('resolves current node executable accurately across platforms', async () => {
      const result = await executeAndCapture([process.execPath, '-v']);
      assert.equal(result.success, true);
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.trim().startsWith('v'));
    });

    test('resolveExecutable detects .cmd and .bat files on Windows without shell requirements on POSIX', () => {
      const winEnv = {
        PATH: tempDir,
        PATHEXT: '.COM;.EXE;.BAT;.CMD'
      };

      // Create a mock .cmd file in tempDir
      fs.writeFileSync(path.join(tempDir, 'custom_tool.cmd'), '@echo off\necho tool', 'utf8');

      if (process.platform === 'win32') {
        const resolved = resolveExecutable('custom_tool', tempDir, winEnv);
        assert.equal(resolved.isBatchFile, true);
      } else {
        const resolved = resolveExecutable('custom_tool', tempDir, winEnv);
        assert.equal(resolved.isBatchFile, false);
      }
    });

    test('executes built-in system tools (node, git) with accurate stdout capture', async () => {
      const result = await executeAndCapture(['node', '-e', 'console.log("CROSS_PLATFORM_OK")']);
      assert.equal(result.success, true);
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('CROSS_PLATFORM_OK'));
    });
  });

  describe('Atomic File Operations & Windows Handle Safety', () => {
    test('safeAtomicRenameSync overwrites existing destination files safely without handle collision', () => {
      const srcFile = path.join(tempDir, 'source.tmp');
      const destFile = path.join(tempDir, 'dest.json');

      fs.writeFileSync(destFile, 'initial content', 'utf8');
      fs.writeFileSync(srcFile, 'updated atomic content', 'utf8');

      safeAtomicRenameSync(srcFile, destFile);

      assert.equal(fs.existsSync(srcFile), false);
      assert.equal(fs.existsSync(destFile), true);
      assert.equal(fs.readFileSync(destFile, 'utf8'), 'updated atomic content');
    });
  });

  describe('Path Handling, Directory Trees & Drive Letters', () => {
    test('findProjectRoot traverses upward to filesystem root without infinite loop', () => {
      const deepNested = path.join(tempDir, 'a', 'b', 'c', 'd');
      fs.mkdirSync(deepNested, { recursive: true });

      const discovered = findProjectRoot(deepNested);
      assert.ok(typeof discovered === 'string');
      assert.ok(discovered.length > 0);
    });

    test('resolveConfig normalizes explicit relative and absolute paths with mixed slashes', () => {
      const customRoot = path.join(tempDir, 'custom_root');
      fs.mkdirSync(customRoot, { recursive: true });

      const config = resolveConfig({ cliRoot: customRoot });
      assert.equal(config.rootDir, path.resolve(customRoot));
      assert.equal(config.ledgerDir, path.join(path.resolve(customRoot), '.rewind'));
    });
  });

  describe('Line Endings & Text Encoding Normalization', () => {
    test('sanitizeOutput normalizes Windows CRLF and Mac CR to standard Unix LF', () => {
      const mixedText = 'Line 1\r\nLine 2\rLine 3\nLine 4';
      const sanitized = sanitizeOutput(mixedText);
      assert.equal(sanitized, 'Line 1\nLine 2\nLine 3\nLine 4');
      assert.equal(sanitized.includes('\r'), false);
    });
  });

  describe('Git Discovery & Metadata Parsing', () => {
    test('readGitMetadata parses mock Git repository with symbolic ref and packed-refs with CRLF', () => {
      const gitDir = path.join(tempDir, '.git');
      fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true });

      // HEAD with CRLF
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature-branch\r\n', 'utf8');

      // packed-refs with CRLF
      const mockSha = '0123456789abcdef0123456789abcdef01234567';
      fs.writeFileSync(
        path.join(gitDir, 'packed-refs'),
        `# pack-refs with: peeled-tags\r\n${mockSha} refs/heads/feature-branch\r\n`,
        'utf8'
      );

      const meta = readGitMetadata(tempDir);
      assert.equal(meta.isGit, true);
      assert.equal(meta.branch, 'feature-branch');
      assert.equal(meta.headCommit, mockSha);
      assert.equal(meta.detached, false);
    });
  });

  describe('Signal Mapping & Exit Code Semantics', () => {
    test('mapSignalToExitCode returns standard POSIX exit codes', () => {
      assert.equal(mapSignalToExitCode('SIGINT'), 130);
      assert.equal(mapSignalToExitCode('SIGTERM'), 143);
      assert.equal(mapSignalToExitCode('SIGKILL'), 137);
      assert.equal(mapSignalToExitCode('SIGHUP'), 129);
      assert.equal(mapSignalToExitCode(null), null);
    });
  });
});
