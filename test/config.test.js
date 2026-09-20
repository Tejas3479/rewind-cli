import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { resolveConfig, findProjectRoot, DEFAULT_LEDGER_DIR, DEFAULT_SETTINGS, VERSION } from '../src/config.js';

describe('Config & Root Discovery (src/config.js)', () => {
  test('VERSION is exported as 1.0.0', () => {
    assert.equal(VERSION, '1.0.0');
  });

  test('DEFAULT_SETTINGS contains required defaults', () => {
    assert.equal(DEFAULT_SETTINGS.defaultLimit, 20);
    assert.equal(DEFAULT_SETTINGS.colorOutput, true);
    assert.equal(DEFAULT_SETTINGS.hookShell, 'bash');
    assert.deepEqual(DEFAULT_SETTINGS.redactPatterns, []);
    assert.equal(DEFAULT_SETTINGS.maxEvidenceSize, 65536);
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

  test('resolveConfig merges config files with correct priority order', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-config-merge-'));
    try {
      const ledgerDir = path.join(tmpBase, DEFAULT_LEDGER_DIR);
      fs.mkdirSync(ledgerDir, { recursive: true });

      // 1. Project-level .rewindrc
      fs.writeFileSync(
        path.join(tmpBase, '.rewindrc'),
        JSON.stringify({ defaultLimit: 50, customProjectKey: 'from_rc' })
      );

      // 2. Project-level rewind.config.json (overrides .rewindrc)
      fs.writeFileSync(
        path.join(tmpBase, 'rewind.config.json'),
        JSON.stringify({ defaultLimit: 100, hookShell: 'zsh' })
      );

      // 3. Ledger-level config.json (highest project priority)
      fs.writeFileSync(
        path.join(ledgerDir, 'config.json'),
        JSON.stringify({ hookShell: 'fish', ledgerKey: 'active' })
      );

      const config = resolveConfig({ cliRoot: tmpBase, cwd: tmpBase });

      assert.equal(config.settings.defaultLimit, 100);
      assert.equal(config.settings.hookShell, 'fish');
      assert.equal(config.settings.customProjectKey, 'from_rc');
      assert.equal(config.settings.ledgerKey, 'active');
      assert.equal(config.settings.colorOutput, true);
    } finally {
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
    }
  });

  test('resolveConfig safely handles malformed JSON in config file without crashing', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-bad-json-'));
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };

    try {
      fs.writeFileSync(path.join(tmpBase, '.rewindrc'), 'NOT_VALID_JSON{:::');

      const config = resolveConfig({ cliRoot: tmpBase, cwd: tmpBase });

      assert.equal(config.settings.defaultLimit, DEFAULT_SETTINGS.defaultLimit);
      assert.equal(warned, true);
    } finally {
      console.warn = originalWarn;
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
    }
  });
});

