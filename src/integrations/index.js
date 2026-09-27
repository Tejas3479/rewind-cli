import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installCursorIntegration } from './cursor.js';
import { installGeminiIntegration } from './gemini.js';
import { installCodexIntegration } from './codex.js';

/**
 * Detects agent environments present in the given workspace root or user system.
 *
 * @param {string} [rootDir=process.cwd()]
 * @param {object} [options]
 * @param {boolean} [options.checkUser] - Whether to check user profile directories (~/.cursor, ~/.gemini, etc.)
 * @param {boolean} [options.checkEnv] - Whether to check environment variables
 * @returns {{ cursor: boolean, gemini: boolean, codex: boolean, detected: string[], details: object }}
 */
export function detectAgentEnvironments(rootDir = process.cwd(), options = {}) {
  const isCwd = path.resolve(rootDir) === path.resolve(process.cwd());
  const checkUser = typeof options.checkUser === 'boolean' ? options.checkUser : isCwd;
  const checkEnv = typeof options.checkEnv === 'boolean' ? options.checkEnv : isCwd;
  const detected = [];
  const homeDir = os.homedir?.() || process.env.HOME || process.env.USERPROFILE || '';

  // 1. Detect Cursor
  const hasCursorDir = fs.existsSync(path.join(rootDir, '.cursor'));
  const hasCursorRules = fs.existsSync(path.join(rootDir, '.cursorrules'));
  const hasCursorEnv = checkEnv && Boolean(process.env.CURSOR_TRACE_DIR || process.env.CURSOR_PROJECT_DIR);
  const hasCursorUser = checkUser && Boolean(homeDir && fs.existsSync(path.join(homeDir, '.cursor')));
  const isCursor = hasCursorDir || hasCursorRules || hasCursorEnv || hasCursorUser;
  if (isCursor) detected.push('Cursor');

  // 2. Detect Gemini
  const hasGeminiDir = fs.existsSync(path.join(rootDir, '.gemini'));
  const hasGeminiEnv = checkEnv && Boolean(process.env.GEMINI_CLI || process.env.GEMINI_PROJECT_DIR);
  const hasGeminiUser = checkUser && Boolean(homeDir && fs.existsSync(path.join(homeDir, '.gemini')));
  const isGemini = hasGeminiDir || hasGeminiEnv || hasGeminiUser;
  if (isGemini) detected.push('Gemini');

  // 3. Detect Codex
  const hasCodexDir = fs.existsSync(path.join(rootDir, '.codex'));
  const hasCodexEnv = checkEnv && Boolean(process.env.CODEX_PROJECT_DIR);
  const hasCodexUser = checkUser && Boolean(homeDir && fs.existsSync(path.join(homeDir, '.codex')));
  const isCodex = hasCodexDir || hasCodexEnv || hasCodexUser;
  if (isCodex) detected.push('Codex');

  return {
    cursor: isCursor,
    gemini: isGemini,
    codex: isCodex,
    detected,
    details: {
      cursor: { project: hasCursorDir || hasCursorRules, user: hasCursorUser, env: hasCursorEnv },
      gemini: { project: hasGeminiDir, user: hasGeminiUser, env: hasGeminiEnv },
      codex: { project: hasCodexDir, user: hasCodexUser, env: hasCodexEnv }
    }
  };
}

/**
 * Installs integration hooks for all detected agent environments.
 *
 * @param {string} rootDir
 * @param {object} [options]
 * @returns {{ installed: string[], filesCreated: string[] }}
 */
export function installAllDetected(rootDir, options = {}) {
  const envs = detectAgentEnvironments(rootDir, options);
  const installed = [];
  const filesCreated = [];

  // Default to installing Cursor integration if none specifically detected, as Cursor is the primary target
  if (envs.cursor || envs.detected.length === 0) {
    const res = installCursorIntegration(rootDir, options);
    installed.push('Cursor');
    filesCreated.push(...res.filesCreated);
  }

  if (envs.gemini) {
    const res = installGeminiIntegration(rootDir, options);
    installed.push('Gemini');
    filesCreated.push(...res.filesCreated);
  }

  if (envs.codex) {
    const res = installCodexIntegration(rootDir, options);
    installed.push('Codex');
    filesCreated.push(...res.filesCreated);
  }

  return {
    installed,
    filesCreated
  };
}
