import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectAgentEnvironments, installAllDetected } from '../src/integrations/index.js';
import { installCursorIntegration } from '../src/integrations/cursor.js';
import { runCLI } from '../src/cli.js';
import { Writable } from 'node:stream';

function createMockIO() {
  let stdoutData = '';
  let stderrData = '';
  const stdout = new Writable({
    write(chunk, enc, cb) { stdoutData += chunk.toString(); cb(); }
  });
  const stderr = new Writable({
    write(chunk, enc, cb) { stderrData += chunk.toString(); cb(); }
  });
  return {
    stdout,
    stderr,
    getStdout: () => stdoutData,
    getStderr: () => stderrData
  };
}

describe('Agent Integrations & Guided Setup (src/integrations/ & src/commands/setup.js)', () => {
  test('detectAgentEnvironments identifies present agent directories', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-detect-'));
    try {
      // Create .cursor/ and .gemini/
      fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, '.gemini'), { recursive: true });

      const envs = detectAgentEnvironments(tmpDir);
      assert.equal(envs.cursor, true);
      assert.equal(envs.gemini, true);
      assert.equal(envs.codex, false);
      assert.ok(envs.detected.includes('Cursor'));
      assert.ok(envs.detected.includes('Gemini'));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('installCursorIntegration writes valid .cursor/hooks.json and bridge script', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-cursor-install-'));
    try {
      const { filesCreated } = installCursorIntegration(tmpDir);
      assert.ok(filesCreated.length >= 2);

      const hooksJsonPath = path.join(tmpDir, '.cursor', 'hooks.json');
      const scriptPath = path.join(tmpDir, 'scripts', 'rewind-cursor-hook.js');

      assert.ok(fs.existsSync(hooksJsonPath));
      assert.ok(fs.existsSync(scriptPath));

      const hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
      assert.equal(hooksConfig.version, 1);
      assert.ok(Array.isArray(hooksConfig.hooks.postToolUseFailure));
      assert.equal(hooksConfig.hooks.postToolUseFailure[0].command, 'node scripts/rewind-cursor-hook.js');

      const scriptContent = fs.readFileSync(scriptPath, 'utf8');
      assert.ok(scriptContent.includes('event'));
      assert.ok(scriptContent.includes('--json'));
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('rewind setup --dry-run prints plan without creating files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-setup-dry-'));
    try {
      const io = createMockIO();

      const exitCode = await runCLI([
        '--root', tmpDir,
        'setup',
        '--dry-run'
      ], {
        ...io,
        isTTY: false
      });

      assert.equal(exitCode, 0);
      assert.ok(io.getStdout().includes('Files that would be created'));
      // Verify no files were actually written
      assert.equal(fs.existsSync(path.join(tmpDir, '.cursor')), false);
      assert.equal(fs.existsSync(path.join(tmpDir, 'scripts')), false);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('rewind setup --json outputs machine-readable configuration result', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-setup-json-'));
    try {
      const io = createMockIO();

      const exitCode = await runCLI([
        '--root', tmpDir,
        'setup',
        '--json'
      ], {
        ...io,
        isTTY: false
      });

      assert.equal(exitCode, 0);
      const res = JSON.parse(io.getStdout());
      assert.ok(res);
      assert.equal(res.rootDir, tmpDir);
      assert.ok(Array.isArray(res.installed));
      assert.ok(res.installed.includes('Cursor'));
      assert.ok(res.filesCreated.length >= 2);

      // Verify no CLAUDE.md or .cursorrules clutter was created
      assert.equal(fs.existsSync(path.join(tmpDir, 'CLAUDE.md')), false);
      assert.equal(fs.existsSync(path.join(tmpDir, '.cursorrules')), false);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
});
