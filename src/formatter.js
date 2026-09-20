import { stripAnsi } from './sanitizer.js';

/**
 * Formatter handles terminal color styling, TTY detection, NO_COLOR compliance,
 * relative time formatting, semantic status badges, and JSON serialization.
 */

/**
 * ANSI escape codes for basic terminal formatting.
 */
const ANSI_CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

/**
 * Returns the visible character length of a string by stripping ANSI escape sequences.
 *
 * @param {string} str
 * @returns {number}
 */
export function visibleLength(str) {
  if (!str) return 0;
  return stripAnsi(String(str)).length;
}

/**
 * Checks if color output should be enabled for a given stream and environment.
 *
 * Rules:
 * 1. If explicitly disabled via flag (noColorFlag = true), color is FALSE.
 * 2. If NO_COLOR environment variable is set and not empty, color is FALSE (https://no-color.org).
 * 3. If FORCE_COLOR is set to '1', 'true', or non-zero, color is TRUE.
 * 4. If stream is a TTY and NODE_DISABLE_COLORS is not set, color is TRUE.
 * 5. Otherwise, color is FALSE.
 *
 * @param {object} [options]
 * @param {boolean} [options.isTTY=false]
 * @param {Record<string, string>} [options.env=process.env]
 * @param {boolean} [options.noColorFlag=false]
 * @returns {boolean}
 */
export function shouldEnableColor({ isTTY = false, env = process.env, noColorFlag = false } = {}) {
  if (noColorFlag) {
    return false;
  }
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
    return false;
  }
  if (env.NODE_DISABLE_COLORS === '1') {
    return false;
  }
  if (env.FORCE_COLOR === '0' || env.FORCE_COLOR === 'false') {
    return false;
  }
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '') {
    return true;
  }
  return Boolean(isTTY);
}

/**
 * Creates a styler instance configured with color capability.
 *
 * @param {boolean} enabled - Whether colors are enabled
 */
export function createStyler(enabled) {
  const style = (openCode, text) => {
    if (!enabled || text === '' || text === null || text === undefined) {
      return String(text ?? '');
    }
    return `${openCode}${text}${ANSI_CODES.reset}`;
  };

  return {
    enabled,
    bold: (text) => style(ANSI_CODES.bold, text),
    dim: (text) => style(ANSI_CODES.dim, text),
    italic: (text) => style(ANSI_CODES.italic, text),
    underline: (text) => style(ANSI_CODES.underline, text),
    red: (text) => style(ANSI_CODES.red, text),
    green: (text) => style(ANSI_CODES.green, text),
    yellow: (text) => style(ANSI_CODES.yellow, text),
    blue: (text) => style(ANSI_CODES.blue, text),
    magenta: (text) => style(ANSI_CODES.magenta, text),
    cyan: (text) => style(ANSI_CODES.cyan, text),
    white: (text) => style(ANSI_CODES.white, text),
    gray: (text) => style(ANSI_CODES.gray, text),
    stripAnsi: (text) => stripAnsi(text),
    visibleLength: (text) => visibleLength(text),
    badge: (label, colorFn) => {
      const fn = colorFn || ((t) => style(ANSI_CODES.bold, t));
      return fn(`[${label}]`);
    }
  };
}

/**
 * Formats an ISO date string into human-friendly relative time (e.g. '2m ago', '3h ago', '1d ago').
 *
 * @param {string} isoString
 * @param {Date} [now=new Date()]
 * @returns {string}
 */
export function formatRelativeTime(isoString, now = new Date()) {
  if (!isoString) return 'unknown';
  try {
    const date = new Date(isoString);
    const diffMs = now.getTime() - date.getTime();
    if (Number.isNaN(diffMs)) return isoString;

    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 0) return 'in the future';
    if (diffSec < 45) return 'just now';
    if (diffSec < 90) return '1m ago';

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;

    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;

    const diffYears = Math.floor(diffDays / 365);
    return `${diffYears}y ago`;
  } catch {
    return isoString;
  }
}

/**
 * Formats semantic state label with appropriate terminal emphasis.
 *
 * @param {string} status
 * @param {ReturnType<createStyler>} styler
 * @returns {string}
 */
export function formatStatusBadge(status, styler) {
  const s = styler;
  switch (status) {
    case 'RECOVERED':
    case 'VERIFIED':
      return s.green(s.bold(status === 'RECOVERED' ? 'RECOVERED' : 'VERIFIED'));
    case 'REGRESSED':
      return s.red(s.bold('REGRESSED'));
    case 'OPEN':
      return s.cyan(s.bold('OPEN'));
    case 'FIXED':
      return s.cyan(s.bold('FIXED'));
    case 'SUSPECTED':
      return s.yellow(s.bold('SUSPECTED'));
    case 'PROPOSED':
      return s.yellow(s.bold('PROPOSED'));
    case 'ATTEMPTED':
      return s.cyan(s.bold('ATTEMPTED'));
    case 'FAILED':
      return s.red(s.bold('FAILED'));
    case 'RESOLVED':
      return s.blue(s.bold('RESOLVED'));
    case 'OBSERVED':
    default:
      return s.dim(status || 'OBSERVED');
  }
}

/**
 * Formats a clean boxed notification for major state milestones (verification, regressions).
 * Uses visible length calculation to ensure borders remain aligned even with ANSI escape sequences.
 *
 * @param {string} title
 * @param {Array<{ label: string, value: string }>} fields
 * @param {ReturnType<createStyler>} styler
 * @param {'success'|'error'|'warning'|'info'} [tone='info']
 * @param {object} [options]
 * @param {number} [options.width=64]
 * @returns {string}
 */
export function formatBox(title, fields, styler, tone = 'info', options = {}) {
  const s = styler;
  const targetWidth = options.width || 64;

  let maxContentWidth = visibleLength(title) + 4;
  for (const field of fields) {
    const rawLabel = `${field.label}:`;
    const labelWidth = Math.max(22, rawLabel.length + 2);
    const valWidth = visibleLength(field.value);
    maxContentWidth = Math.max(maxContentWidth, labelWidth + valWidth + 4);
  }

  const width = Math.max(targetWidth, maxContentWidth);

  const topBorder = `┌${'─'.repeat(width - 2)}┐`;
  const bottomBorder = `└${'─'.repeat(width - 2)}┘`;

  const coloredTitle = tone === 'success'
    ? s.green(s.bold(title))
    : tone === 'error' || tone === 'warning'
      ? s.red(s.bold(title))
      : s.bold(title);

  const titlePadding = Math.max(0, width - 4 - visibleLength(title));

  const lines = [
    topBorder,
    `│ ${coloredTitle}${' '.repeat(titlePadding)} │`,
    `│${' '.repeat(width - 2)}│`
  ];

  for (const field of fields) {
    const rawLabel = `${field.label}:`;
    const labelPadLen = Math.max(22, visibleLength(rawLabel));
    const labelStr = s.dim(rawLabel.padEnd(labelPadLen));
    const valStr = field.value;
    const contentVisLen = labelPadLen + 1 + visibleLength(valStr);
    const padding = Math.max(0, width - 4 - contentVisLen);

    lines.push(`│ ${labelStr} ${valStr}${' '.repeat(padding)} │`);
  }

  lines.push(bottomBorder);
  return lines.join('\n');
}

/**
 * Formats full UTC timestamp string.
 *
 * @param {string} isoString
 * @returns {string}
 */
export function formatUtc(isoString) {
  if (!isoString) return 'unknown';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return 'Invalid Date';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  } catch {
    return String(isoString);
  }
}

/**
 * Serializes an object to formatted JSON.
 *
 * @param {unknown} data
 * @returns {string}
 */
export function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

/**
 * Formats an error with structured diagnosis and remediation suggestion.
 *
 * @param {Error|unknown} err
 * @param {ReturnType<createStyler>} styler
 * @returns {string}
 */
export function formatError(err, styler) {
  const s = styler;
  const prefix = s.red(s.bold('error:'));
  const message = err instanceof Error ? err.message : String(err);
  let formatted = `${prefix} ${message}`;

  if (err && typeof err === 'object' && err.details) {
    const details = err.details;
    if (details.suggestion) {
      formatted += `\n  ${s.dim('hint:')} ${details.suggestion}`;
    }
  }

  return formatted;
}
