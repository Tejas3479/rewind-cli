import { ConfidenceLevel, createStructuredDiagnostic } from '../model.js';

// Python traceback header signature
const PYTHON_TRACEBACK_HEADER = 'Traceback (most recent call last):';

// Frame line pattern: '  File "/path/to/file.py", line 42, in my_func'
const PYTHON_FRAME_REGEX = /^\s*File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?$/;

// Final exception line pattern: 'ValueError: invalid literal' or 'IndexError: list index out of range'
const PYTHON_EXCEPTION_REGEX = /^([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception|Warning|Exit|Interrupt|Fault|StopIteration|KeyError|IndexError|TypeError|ValueError|NameError|AttributeError|ImportError|ModuleNotFoundError))(?::\s*(.*))?$/;


/**
 * Attempts to parse raw process output into a Python StructuredDiagnostic.
 *
 * @param {string} text - Raw error text (stderr or stdout)
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
export function parsePythonDiagnostic(text) {
  if (!text || typeof text !== 'string') return null;

  const hasTracebackHeader = text.includes(PYTHON_TRACEBACK_HEADER);
  const hasFileFrame = /File\s+"[^"]+",\s+line\s+\d+/.test(text);

  // Conservative filter: Must have traceback header OR explicit python File "... line \d+" frame
  if (!hasTracebackHeader && !hasFileFrame) {
    return null;
  }

  // Check for chained exceptions: split by "During handling of the above exception..."
  let nestedCause = null;
  const chainedSplit = text.split(/(?:During handling of the above exception, another exception occurred:|The above exception was the direct cause of the following exception:)/);
  if (chainedSplit.length > 1) {
    // Primary exception is the last one in Python traceback chains
    nestedCause = parsePythonDiagnostic(chainedSplit[0].trim());
    text = chainedSplit[chainedSplit.length - 1].trim();
  }

  const lines = text.split(/\r?\n/).map(l => l.trimEnd());
  const stackFrames = [];
  let errorType = null;
  let message = null;
  let rawHeader = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for frame line: File "...", line X, in Y
    const frameMatch = trimmed.match(PYTHON_FRAME_REGEX);
    if (frameMatch) {
      const file = frameMatch[1].trim();
      const lineNum = Number.parseInt(frameMatch[2], 10);
      const fn = frameMatch[3] ? frameMatch[3].trim() : null;
      stackFrames.push({
        function: fn,
        file,
        line: Number.isNaN(lineNum) ? null : lineNum,
        column: null,
        raw: trimmed
      });
      continue;
    }

    // Check for final exception line
    const excMatch = trimmed.match(PYTHON_EXCEPTION_REGEX);
    if (excMatch) {
      errorType = excMatch[1];
      message = excMatch[2] !== undefined ? excMatch[2].trim() : '';
      rawHeader = trimmed;
      continue;
    }
  }

  // If no explicit errorType parsed, check for SyntaxError / IndentationError
  if (!errorType) {
    const lastNonEmpty = [...lines].reverse().find(l => l.trim().length > 0);
    if (lastNonEmpty) {
      const match = lastNonEmpty.trim().match(/^([A-Za-z0-9_]+Error):\s*(.*)$/);
      if (match) {
        errorType = match[1];
        message = match[2] ? match[2].trim() : '';
        rawHeader = lastNonEmpty.trim();
      }
    }
  }

  // If we still found no frames and no errorType, but traceback header was present, extract last line as message
  if (!errorType && stackFrames.length === 0) {
    if (hasTracebackHeader) {
      const lastLine = [...lines].reverse().find(l => l.trim().length > 0 && !l.includes(PYTHON_TRACEBACK_HEADER));
      errorType = 'Traceback';
      message = lastLine ? lastLine.trim() : 'Malformed Python Traceback';
    } else {
      return null;
    }
  }

  // Primary source frame in Python is the BOTTOM-most frame in the traceback
  const primaryFrame = stackFrames.length > 0 ? stackFrames[stackFrames.length - 1] : null;

  const confidence = (hasTracebackHeader || (errorType && stackFrames.length > 0))
    ? ConfidenceLevel.EXACTLY_PARSED
    : ConfidenceLevel.INFERRED;

  return createStructuredDiagnostic({
    language: 'python',
    runtime: 'cpython',
    errorType: errorType || 'Exception',
    errorCode: null,
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
      errorCode: ConfidenceLevel.UNKNOWN,
      location: primaryFrame?.file ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN,
      message: message !== null ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN
    },
    rawEvidenceSnippet: rawHeader || text.slice(0, 300).trim()
  });
}
