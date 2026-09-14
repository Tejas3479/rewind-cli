import { ConfidenceLevel, createStructuredDiagnostic } from './model.js';
import { parseNodeDiagnostic } from './parsers/node.js';
import { parsePythonDiagnostic } from './parsers/python.js';
import { parseRustDiagnostic } from './parsers/rust.js';
import { parseGoDiagnostic } from './parsers/go.js';
import { parseAwsDiagnostic } from './parsers/aws.js';
import { parseTerraformDiagnostic } from './parsers/terraform.js';
import { parseKubernetesDiagnostic } from './parsers/kubernetes.js';
import { parseJavaDiagnostic } from './parsers/java.js';

export { ConfidenceLevel, createStructuredDiagnostic };
export { 
  parseNodeDiagnostic, 
  parsePythonDiagnostic, 
  parseRustDiagnostic, 
  parseGoDiagnostic,
  parseAwsDiagnostic,
  parseTerraformDiagnostic,
  parseKubernetesDiagnostic,
  parseJavaDiagnostic
};

/**
 * Registry of diagnostic parsers executed in priority order.
 */
const PARSER_REGISTRY = [
  { name: 'aws', parse: parseAwsDiagnostic },
  { name: 'terraform', parse: parseTerraformDiagnostic },
  { name: 'python', parse: parsePythonDiagnostic },
  { name: 'java', parse: parseJavaDiagnostic },
  { name: 'rust', parse: parseRustDiagnostic },
  { name: 'go', parse: parseGoDiagnostic },
  { name: 'kubernetes', parse: parseKubernetesDiagnostic },
  { name: 'node', parse: parseNodeDiagnostic }
];

/**
 * Registers a new diagnostic parser function into the registry.
 *
 * @param {string} name
 * @param {(text: string, context?: object) => import('./model.js').StructuredDiagnostic | null} parserFn
 */
export function registerParser(name, parserFn) {
  if (typeof parserFn === 'function') {
    PARSER_REGISTRY.push({ name, parse: parserFn });
  }
}

/**
 * Parses raw stderr and stdout into a conservative, structured diagnostic representation.
 *
 * @param {string} [rawStderr=''] - Raw or sanitized stderr
 * @param {string} [rawStdout=''] - Raw or sanitized stdout
 * @param {object} [context={}] - Execution context (e.g. command executable, cwd)
 * @returns {import('./model.js').StructuredDiagnostic}
 */
export function parseDiagnostic(rawStderr = '', rawStdout = '', context = {}) {
  const stderr = typeof rawStderr === 'string' ? rawStderr : '';
  const stdout = typeof rawStdout === 'string' ? rawStdout : '';

  // 1. Primary candidate text is stderr, falling back to stdout
  const primaryText = stderr.trim().length > 0 ? stderr : stdout;

  if (!primaryText || primaryText.trim().length === 0) {
    return createStructuredDiagnostic({
      language: null,
      runtime: null,
      errorType: null,
      errorCode: null,
      message: null,
      sourceFile: null,
      line: null,
      column: null,
      stackFrames: [],
      confidence: ConfidenceLevel.UNKNOWN,
      rawEvidenceSnippet: ''
    });
  }

  // 2. Run prioritized parsers against primary error text
  for (const { parse } of PARSER_REGISTRY) {
    try {
      const result = parse(primaryText, context);
      if (result && result.language) {
        return result;
      }
    } catch {
      // Individual parser failed: continue to next candidate
    }
  }

  // 3. If stderr didn't match and stdout has content, check stdout as fallback
  if (stderr.trim().length > 0 && stdout.trim().length > 0 && primaryText !== stdout) {
    for (const { parse } of PARSER_REGISTRY) {
      try {
        const result = parse(stdout, context);
        if (result && result.language) {
          return result;
        }
      } catch {
        // Continue
      }
    }
  }

  // 4. Fallback for unclassified outputs: preserve raw snippet with UNKNOWN confidence
  const firstLine = primaryText.split(/\r?\n/).find(l => l.trim().length > 0) || '';

  return createStructuredDiagnostic({
    language: null,
    runtime: null,
    errorType: null,
    errorCode: null,
    message: firstLine.trim() || null,
    sourceFile: null,
    line: null,
    column: null,
    stackFrames: [],
    confidence: ConfidenceLevel.UNKNOWN,
    confidenceByField: {
      language: ConfidenceLevel.UNKNOWN,
      errorType: ConfidenceLevel.UNKNOWN,
      errorCode: ConfidenceLevel.UNKNOWN,
      location: ConfidenceLevel.UNKNOWN,
      message: firstLine.trim() ? ConfidenceLevel.INFERRED : ConfidenceLevel.UNKNOWN
    },
    rawEvidenceSnippet: primaryText.slice(0, 300).trim()
  });
}
