import fs from 'node:fs';
import path from 'node:path';
import { installCursorIntegration } from './cursor.js';
import { installGeminiIntegration } from './gemini.js';
import { installCodexIntegration } from './codex.js';

/**
 * Detects agent environments present in the given workspace root.
 *
 * @param {string} [rootDir=process.cwd()]
 * @returns {{ cursor: boolean, gemini: boolean, codex: boolean, detected: string[] }}
 */
export function detectAgentEnvironments(rootDir = process.cwd()) {
  const detected = [];

  // 1. Detect Cursor
  const hasCursorDir = fs.existsSync(path.join(rootDir, '.cursor'));
  const hasCursorRules = fs.existsSync(path.join(rootDir, '.cursorrules'));
  const hasCursorEnv = Boolean(process.env.CURSOR_TRACE_DIR || process.env.CURSOR_PROJECT_DIR);
  const isCursor = hasCursorDir || hasCursorRules || hasCursorEnv;
  if (isCursor) detected.push('Cursor');

  // 2. Detect Gemini
  const hasGeminiDir = fs.existsSync(path.join(rootDir, '.gemini'));
  const isGemini = hasGeminiDir;
  if (isGemini) detected.push('Gemini');

  // 3. Detect Codex
  const hasCodexDir = fs.existsSync(path.join(rootDir, '.codex'));
  const isCodex = hasCodexDir;
  if (isCodex) detected.push('Codex');

  return {
    cursor: isCursor,
    gemini: isGemini,
    codex: isCodex,
    detected
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
  const envs = detectAgentEnvironments(rootDir);
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
