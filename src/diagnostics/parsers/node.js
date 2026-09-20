import { ConfidenceLevel, createStructuredDiagnostic } from '../model.js';

// Standard V8 / Node.js error class names
const NODE_ERROR_TYPES = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'URIError',
  'EvalError',
  'AssertionError',
  'SystemError'
]);

// Header matching: "TypeError: message" or "Error [ERR_CODE]: message"
const NODE_HEADER_REGEX = /^(?:([A-Z][A-Za-z0-9_]*Error|Error)(?:\s*\[([A-Z0-9_]+)\])?|\[([A-Z0-9_]+)\]):\s*(.*)$/;


// Stack frame line patterns:
// 1. "    at func (/path/file.js:42:10)" or "    at async func (C:\path\file.ts:42:10)"
// 2. "    at /path/file.js:42:10" or "    at C:\path\file.js:42:10"
// 3. "    at file:///path/file.js:42:10"
const STACK_FRAME_WITH_FUNC = /^\s*at\s+(?:async\s+)?(.+?)\s+\((?:file:\/\/\/?)?([A-Za-z]:\\[^()]+|\/[^()]+|node:[^()]+|[^():]+):(\d+):(\d+)\)$/;
const STACK_FRAME_NO_FUNC = /^\s*at\s+(?:file:\/\/\/?)?([A-Za-z]:\\[^()]+|\/[^()]+|node:[^()]+|[^():]+):(\d+):(\d+)$/;

/**
 * Normalizes a file path extracted from a stack trace.
 *
 * @param {string} rawPath
 * @returns {string}
 */
function normalizeFilePath(rawPath) {
  if (!rawPath) return '';
  return rawPath
    .replace(/^file:\/\/\/?/, '')
    .trim();
}

/**
 * Determines whether a stack frame originates from internal Node.js runtime code.
 *
 * @param {string} file
 * @returns {boolean}
 */
function isInternalNodeFrame(file) {
  if (!file) return false;
  return file.startsWith('node:') || file.includes('node:internal') || file.includes('internal/') || file.startsWith('internal/');
}

/**
 * Attempts to parse raw process output into a Node.js / V8 StructuredDiagnostic.
 *
 * @param {string} text - Raw error text (stderr or stdout)
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
export function parseNodeDiagnostic(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split(/\r?\n/).map(l => l.trimEnd());
  if (lines.length === 0) return null;

  let errorType = null;
  let errorCode = null;
  let message = null;
  const stackFrames = [];
  let rawHeader = '';
  let headerIndex = -1;

  // 1. Find the error header line and parse stack frames
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for standard Node/V8 error header
    const headerMatch = line.match(NODE_HEADER_REGEX);
    if (headerMatch && !errorType) {
      errorType = headerMatch[1] || 'Error';
      errorCode = headerMatch[2] || headerMatch[3] || null;
      message = headerMatch[4] ? headerMatch[4].trim() : '';
      rawHeader = line;
      headerIndex = i;

      // Extract system error code from message if present (e.g. "connect ECONNREFUSED 127.0.0.1:5432")
      if (!errorCode && message) {
        const sysMatch = message.match(/\b(E[A-Z0-9_]{3,})\b/);
        if (sysMatch) {
          errorCode = sysMatch[1];
        }
      }
      continue;
    }

    // Check for stack frame lines: "    at ..."
    if (line.startsWith('at ') || lines[i].startsWith('    at ')) {
      const matchWithFunc = line.match(STACK_FRAME_WITH_FUNC);
      if (matchWithFunc) {
        const fn = matchWithFunc[1].trim();
        const file = normalizeFilePath(matchWithFunc[2]);
        const lineNum = Number.parseInt(matchWithFunc[3], 10);
        const colNum = Number.parseInt(matchWithFunc[4], 10);
        stackFrames.push({
          function: fn,
          file,
          line: Number.isNaN(lineNum) ? null : lineNum,
          column: Number.isNaN(colNum) ? null : colNum,
          raw: line
        });
        continue;
      }

      const matchNoFunc = line.match(STACK_FRAME_NO_FUNC);
      if (matchNoFunc) {
        const file = normalizeFilePath(matchNoFunc[1]);
        const lineNum = Number.parseInt(matchNoFunc[2], 10);
        const colNum = Number.parseInt(matchNoFunc[3], 10);
        stackFrames.push({
          function: null,
          file,
          line: Number.isNaN(lineNum) ? null : lineNum,
          column: Number.isNaN(colNum) ? null : colNum,
          raw: line
        });
        continue;
      }
    }
  }

  // If no Node error header and no stack frames were found, this is not a Node error
  if (!errorType && stackFrames.length === 0) {
    return null;
  }

  // If stack frames exist but header was not standard, infer errorType
  if (!errorType && stackFrames.length > 0) {
    const firstLine = lines.find(l => l.trim().length > 0 && !l.trim().startsWith('at '));
    if (firstLine) {
      message = firstLine.trim();
      errorType = 'Error';
    }
  }

  // Find primary project/user source frame (skipping internal Node frames)
  let primaryFrame = stackFrames.find(f => f.file && !isInternalNodeFrame(f.file));
  if (!primaryFrame && stackFrames.length > 0) {
    primaryFrame = stackFrames[0];
  }

  // Check for nested cause: "[cause]: TypeError: ..." or "Caused by: Error: ..."
  let nestedCause = null;
  const causeIndex = text.indexOf('[cause]:');
  if (causeIndex !== -1) {
    const causeText = text.slice(causeIndex + 8).trim();
    nestedCause = parseNodeDiagnostic(causeText);
  }

  const confidence = (errorType && (stackFrames.length > 0 || errorCode))
    ? ConfidenceLevel.EXACTLY_PARSED
    : ConfidenceLevel.INFERRED;

  return createStructuredDiagnostic({
    language: 'node',
    runtime: 'v8',
    errorType: errorType || 'Error',
    errorCode: errorCode || null,
    message: message || null,
    sourceFile: primaryFrame?.file || null,
    line: primaryFrame?.line || null,
    column: primaryFrame?.column || null,
    stackFrames,
    nestedCause,
    confidence,
    confidenceByField: {
      language: ConfidenceLevel.EXACTLY_PARSED,
      errorType: errorType ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.INFERRED,
      errorCode: errorCode ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN,
      location: primaryFrame?.file ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN,
      message: message ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN
    },
    rawEvidenceSnippet: rawHeader || text.slice(0, 300).trim()
  });
}
