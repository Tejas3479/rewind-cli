import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { resolveConfig, findProjectRoot, DEFAULT_LEDGER_DIR, VERSION } from '../src/config.js';

describe('Config & Root Discovery (src/config.js)', () => {
  test('VERSION is exported as 1.0.0', () => {
    assert.equal(VERSION, '1.0.0');
  });

  test('resolveConfig uses explicit cliRoot when provided', () => {
    const customPath = path.resolve('/tmp/custom-rewind-project');
    const config = resolveConfig({ cliRoot: customPath, cwd: '/some/other/path' });
    assert.equal(config.rootDir, customPath);
    assert.equal(config.ledgerDir, path.join(customPath, DEFAULT_LEDGER_DIR));
  });

  test('resolveConfig uses REWIND_ROOT environment variable when provided', () => {
    const envRoot = path.resolve('/tmp/env-rewind-root');
    const config = resolveConfig({ env: { REWIND_ROOT: envRoot }, cwd: '/some/other/path' });
    assert.equal(config.rootDir, envRoot);
    assert.equal(config.ledgerDir, path.join(envRoot, DEFAULT_LEDGER_DIR));
  });

  test('findProjectRoot discovers nearest .rewind directory upward', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-test-'));
    try {
      const projectRoot = path.join(tmpBase, 'my-project');
      const nestedSubdir = path.join(projectRoot, 'src', 'components');
      const rewindDir = path.join(projectRoot, '.rewind');

      fs.mkdirSync(nestedSubdir, { recursive: true });
      fs.mkdirSync(rewindDir, { recursive: true });

      const discovered = findProjectRoot(nestedSubdir);
      assert.equal(discovered, projectRoot);
    } finally {
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
    }
  });

  test('findProjectRoot falls back to cwd when no root marker found', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-empty-'));
    try {
      const discovered = findProjectRoot(tmpBase);
      assert.equal(discovered, tmpBase);
    } finally {
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
    }
  });
});
