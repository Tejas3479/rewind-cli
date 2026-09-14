
import { ConfidenceLevel, createStructuredDiagnostic } from '../model.js';

const AWS_ERROR_REGEX = /An error occurred \(([^)]+)\) when calling the ([A-Za-z0-9]+) operation:\s*(.*)/;

/**
 * Parses AWS CLI errors.
 *
 * @param {string} text
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
export function parseAwsDiagnostic(text) {
  if (!text || typeof text !== 'string') return null;

  const match = text.match(AWS_ERROR_REGEX);
  if (!match) return null;

  const errorCode = match[1];
  const operation = match[2];
  const message = match[3];

  return createStructuredDiagnostic({
    language: 'aws-cli',
    runtime: 'aws',
    errorType: operation, // Storing the operation in errorType
    errorCode: errorCode,
    message: message.trim(),
    confidence: ConfidenceLevel.EXACTLY_PARSED,
    rawEvidenceSnippet: match[0]
  });
}
