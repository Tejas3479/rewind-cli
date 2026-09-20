/**
 * Output sanitizer, terminal escape stripper, and conservative secret redactor.
 */

// Matches ANSI escape codes (CSI, OSC, DCS, APC, PM, and 2-byte escapes)
const OSC_PATTERN = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
const DCS_APC_PATTERN = /\x1B[P^_][^\x1B]*(?:\x1B\\|\x07)/g;
const CSI_PATTERN = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;
const ESC_SINGLE_PATTERN = /\x1B[@-Z\\-_]/g;

// Matches non-printable control characters excluding \t, \n, \r
const CONTROL_CHARS_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// Secret Patterns
const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/gi;
const OPENAI_KEY_PATTERN = /\bsk-[a-zA-Z0-9_-]{20,}\b/g;
const GITHUB_TOKEN_PATTERN = /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{20,}\b/g;
const AWS_KEY_PATTERN = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const SLACK_TOKEN_PATTERN = /\bxox[baprs]-[0-9a-zA-Z-]{15,}\b/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[a-zA-Z0-9_\-\.]{15,}\b/gi;
const BASIC_AUTH_URL_PATTERN = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^:\s\/@]+:[^@\s\/]+@/gi;
// Note: We use {4,} here to avoid false positives on legitimate single-character config values like `DEBUG=1`, `VERBOSE=0`
const KEY_VALUE_SECRET_PATTERN = /\b(password|passwd|secret|api[_-]?key|auth[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*(?:(['"])(.+?)\2|([^\s'",;&]{3,}))/gi;

/**
 * Strips ANSI escape sequences from a string.
 *
 * @param {string} str
 * @returns {string}
 */
export function stripAnsi(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(OSC_PATTERN, '')
    .replace(DCS_APC_PATTERN, '')
    .replace(CSI_PATTERN, '')
    .replace(ESC_SINGLE_PATTERN, '')
    .replace(/\x1B/g, '');
}

/**
 * Redacts common secret formats (API keys, private keys, bearer tokens, passwords)
 * using conservative regex patterns.
 *
 * Note: Regex redaction reduces accidental leakage of standard token formats in logs,
 * but cannot guarantee 100% detection of arbitrary user secrets.
 *
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  if (typeof text !== 'string') return '';

  return text
    .replace(PEM_PRIVATE_KEY_PATTERN, '[REDACTED_PRIVATE_KEY]')
    .replace(OPENAI_KEY_PATTERN, '[REDACTED_API_KEY]')
    .replace(GITHUB_TOKEN_PATTERN, '[REDACTED_GITHUB_TOKEN]')
    .replace(AWS_KEY_PATTERN, '[REDACTED_AWS_KEY]')
    .replace(SLACK_TOKEN_PATTERN, '[REDACTED_SLACK_TOKEN]')
    .replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]')
    .replace(BASIC_AUTH_URL_PATTERN, '$1[REDACTED]@')
    .replace(KEY_VALUE_SECRET_PATTERN, '$1=[REDACTED]');
}

/**
 * Sanitizes untrusted terminal output for safe storage and display.
 * - Strips ANSI escape sequences
 * - Strips non-printable control characters
 * - Normalizes line breaks to LF (\n)
 *
 * @param {string} str
 * @returns {string}
 */
export function sanitizeOutput(str) {
  if (str === null || str === undefined) return '';
  const text = String(str);

  return stripAnsi(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL_CHARS_PATTERN, '');
}

/**
 * Sanitizes and redacts untrusted output specifically for terminal rendering.
 *
 * @param {string} str
 * @returns {string}
 */
export function sanitizeForDisplay(str) {
  return redactSecrets(sanitizeOutput(str));
}
