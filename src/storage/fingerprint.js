import crypto from 'node:crypto';
import path from 'node:path';
import { normalizeErrorText } from './normalizer.js';

export const FINGERPRINT_VERSION = 2;

/**
 * Formats a failure fingerprint for human display.
 * Pure and deterministic: truncates to length and adds an ellipsis if longer.
 *
 * @param {string} fingerprint
 * @param {number} [length=12]
 * @returns {string}
 */
export function formatShortFingerprint(fingerprint, length = 12) {
  if (!fingerprint || typeof fingerprint !== 'string') return '';
  return fingerprint.length <= length
    ? fingerprint
    : `${fingerprint.slice(0, length)}…`;
}

/**
 * Compares two fingerprints for equality with cross-version compatibility.
 * Matches identical fingerprints or a modern v2 (64 hex chars) with a legacy v1 (16 hex chars) prefix.
 *
 * @param {string} fpA
 * @param {string} fpB
 * @returns {boolean}
 */
export function fingerprintsMatch(fpA, fpB) {
  if (!fpA || !fpB || typeof fpA !== 'string' || typeof fpB !== 'string') return false;
  if (fpA === fpB) return true;
  // Cross-version comparison: 16-char prefix match
  if (fpA.length === 16 && fpB.length === 64) {
    return fpB.startsWith(fpA);
  }
  if (fpB.length === 16 && fpA.length === 64) {
    return fpA.startsWith(fpB);
  }
  return false;
}

/**
 * Generates a deterministic SHA-256 fingerprint from failure properties.
 *
 * Fields contributing to the fingerprint (in order):
 * 1. Normalized command executable name (basename, lowercased)
 * 2. Normalized argument list (joined, trimmed)
 * 3. Process exit code or termination signal
 * 4. Canonically normalized error text (from stderr, or stdout fallback)
 *
 * @param {object} params
 * @param {string} params.command - Executable command
 * @param {string[]} [params.args=[]] - Command arguments
 * @param {number|null} [params.exitCode=1] - Exit code
 * @param {string|null} [params.signal=null] - Termination signal
 * @param {string} [params.stderr=''] - Stderr content
 * @param {string} [params.stdout=''] - Stdout content
 * @param {object} [options]
 * @param {number} [options.version=2] - Target fingerprint version (1 = legacy 16-hex, 2 = full 64-hex SHA-256)
 * @returns {{ fingerprint: string, fingerprintVersion: number, legacyFingerprint: string, normalizedError: string }}
 */
export function computeFingerprint({
  command = '',
  args = [],
  exitCode = null,
  signal = null,
  stderr = '',
  stdout = ''
} = {}, options = {}) {
  const version = options.version ?? FINGERPRINT_VERSION;

  // 1. Normalized command basename (e.g. "node.exe" -> "node", "npm" -> "npm")
  const cmdBase = path.basename(command).replace(/\.(?:exe|cmd|bat|sh|ps1)$/i, '').toLowerCase();

  // 2. Normalized arguments
  const argsSignature = (args || []).map((a) => String(a).trim()).join(' ');

  // 3. Normalized error content (primary from stderr, fallback to stdout)
  const rawError = (stderr && stderr.trim()) ? stderr : (stdout || '');
  const normalizedError = normalizeErrorText(rawError);

  // 4. Deterministic structured payload
  const payload = [
    `cmd:${cmdBase}`,
    `args:${argsSignature}`,
    `code:${exitCode ?? 'null'}`,
    `sig:${signal ?? 'null'}`,
    `err:${normalizedError}`
  ].join('\n--REWIND-FP-SEP--\n');

  const fullDigest = crypto
    .createHash('sha256')
    .update(payload, 'utf8')
    .digest('hex');

  const legacyFingerprint = fullDigest.slice(0, 16);

  return {
    fingerprint: version === 1 ? legacyFingerprint : fullDigest,
    fingerprintVersion: version,
    legacyFingerprint,
    normalizedError
  };
}

/**
 * Computes legacy v1 (16-character) fingerprint for explicit backward-compatibility tests or operations.
 *
 * @param {object} params
 * @returns {{ fingerprint: string, fingerprintVersion: number, legacyFingerprint: string, normalizedError: string }}
 */
export function computeLegacyFingerprint(params) {
  return computeFingerprint(params, { version: 1 });
}
