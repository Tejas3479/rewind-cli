import { ConfidenceLevel, createStructuredDiagnostic } from '../model.js';

const JAVA_EXCEPTION_REGEX = /(?:Exception in thread \"[^\"]+\"\s+)?([a-zA-Z0-9_.$]+(?:Exception|Error))(?::\s*(.*))?/;
const JAVA_STACK_FRAME_REGEX = /^\s*at\s+([a-zA-Z0-9_.$]+(?:<init>)?)\((.*?)(?::(\d+))?\)/;

/**
 * Parses Java exceptions and stack traces.
 *
 * @param {string} text
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
export function parseJavaDiagnostic(text) {
  if (!text || typeof text !== 'string') return null;

  const exceptionMatch = text.match(JAVA_EXCEPTION_REGEX);
  if (!exceptionMatch) return null;

  const errorType = exceptionMatch[1];
  const message = exceptionMatch[2] ? exceptionMatch[2].trim() : '';

  const stackFrames = [];
  const lines = text.split(/\r?\n/);
  
  let hasJavaSourceFile = false;

  for (const line of lines) {
    const frameMatch = line.match(JAVA_STACK_FRAME_REGEX);
    if (frameMatch) {
      const file = frameMatch[2] && frameMatch[2] !== 'Unknown Source' && frameMatch[2] !== 'Native Method' ? frameMatch[2] : null;
      if (file && file.endsWith('.java')) {
        hasJavaSourceFile = true;
      }
      stackFrames.push({
        function: frameMatch[1],
        file: file,
        line: frameMatch[3] ? parseInt(frameMatch[3], 10) : null,
        column: null,
        raw: line.trim()
      });
    }
  }

  // If it's a generic "Error" or "Exception" without "Exception in thread" and no Java stack frames, skip it.
  if (!text.includes('Exception in thread') && !hasJavaSourceFile) {
    return null;
  }

  const primaryFrame = stackFrames.find(f => f.file && f.line) || stackFrames[0];

  return createStructuredDiagnostic({
    language: 'java',
    runtime: 'jvm',
    errorType: errorType,
    message: message,
    sourceFile: primaryFrame ? primaryFrame.file : null,
    line: primaryFrame ? primaryFrame.line : null,
    stackFrames: stackFrames,
    confidence: ConfidenceLevel.EXACTLY_PARSED,
    rawEvidenceSnippet: exceptionMatch[0]
  });
}
