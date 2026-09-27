/**
 * Confidence taxonomy for diagnostic extraction.
 * Distinguishes exact syntactic matches from conservative inferences and unknown data.
 */
export const ConfidenceLevel = Object.freeze({
  EXACTLY_PARSED: 'EXACTLY_PARSED',
  INFERRED: 'INFERRED',
  UNKNOWN: 'UNKNOWN'
});

/**
 * @typedef {object} StackFrame
 * @property {string|null} [function] - Function or method name
 * @property {string|null} [file] - Source file path
 * @property {number|null} [line] - 1-indexed line number
 * @property {number|null} [column] - 1-indexed column number
 * @property {string} raw - Raw unparsed stack line
 */

/**
 * @typedef {object} StructuredDiagnostic
 * @property {string|null} language - Language identifier ('node' | 'python' | 'rust' | 'go' | null)
 * @property {string|null} runtime - Runtime engine identifier ('v8' | 'cpython' | 'rustc' | 'go' | null)
 * @property {string|null} errorType - Specific error or exception class (e.g. 'TypeError', 'ValueError', 'panic')
 * @property {string|null} errorCode - System or compiler error code (e.g. 'ECONNREFUSED', 'E0308', 'ERR_INVALID_ARG_TYPE')
 * @property {string|null} [operation] - Specific operation/action name (e.g. AWS API operation 'GetObject')
 * @property {string|null} message - Primary diagnostic or exception message
 * @property {string|null} sourceFile - Primary offending source file path
 * @property {number|null} line - 1-indexed source line number
 * @property {number|null} column - 1-indexed source column number
 * @property {StackFrame[]} stackFrames - Structured call stack frames
 * @property {StructuredDiagnostic|null} nestedCause - Nested or chained cause diagnostic if detected
 * @property {'EXACTLY_PARSED'|'INFERRED'|'UNKNOWN'} confidence - Overall extraction confidence
 * @property {object} confidenceByField - Confidence classification per field
 * @property {'EXACTLY_PARSED'|'INFERRED'|'UNKNOWN'} confidenceByField.language
 * @property {'EXACTLY_PARSED'|'INFERRED'|'UNKNOWN'} confidenceByField.errorType
 * @property {'EXACTLY_PARSED'|'INFERRED'|'UNKNOWN'} confidenceByField.errorCode
 * @property {'EXACTLY_PARSED'|'INFERRED'|'UNKNOWN'} confidenceByField.location
 * @property {'EXACTLY_PARSED'|'INFERRED'|'UNKNOWN'} confidenceByField.message
 * @property {string} rawEvidenceSnippet - Snippet of raw error text parsed
 */

/**
 * Factory creating a validated, immutable StructuredDiagnostic object with safe defaults.
 *
 * @param {Partial<StructuredDiagnostic>} [fields={}]
 * @returns {StructuredDiagnostic}
 */
export function createStructuredDiagnostic(fields = {}) {
  const confidenceByField = {
    language: fields.confidenceByField?.language || (fields.language ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN),
    errorType: fields.confidenceByField?.errorType || (fields.errorType ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN),
    errorCode: fields.confidenceByField?.errorCode || (fields.errorCode ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN),
    location: fields.confidenceByField?.location || (fields.sourceFile ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN),
    message: fields.confidenceByField?.message || (fields.message ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN)
  };

  const diagnostic = {
    language: fields.language || null,
    runtime: fields.runtime || null,
    errorType: fields.errorType || null,
    errorCode: fields.errorCode || null,
    operation: typeof fields.operation === 'string' ? fields.operation : null,
    message: fields.message !== undefined ? fields.message : null,
    sourceFile: fields.sourceFile || null,
    line: typeof fields.line === 'number' && fields.line > 0 ? fields.line : null,
    column: typeof fields.column === 'number' && fields.column > 0 ? fields.column : null,
    stackFrames: Array.isArray(fields.stackFrames) ? fields.stackFrames : [],
    nestedCause: fields.nestedCause || null,
    confidence: fields.confidence || (fields.language ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.UNKNOWN),
    confidenceByField,
    rawEvidenceSnippet: typeof fields.rawEvidenceSnippet === 'string' ? fields.rawEvidenceSnippet : ''
  };

  return Object.freeze(diagnostic);
}
