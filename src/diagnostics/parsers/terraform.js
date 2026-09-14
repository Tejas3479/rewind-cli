
import { ConfidenceLevel, createStructuredDiagnostic } from '../model.js';

const TF_ERROR_REGEX = /Error:\s*([^\r\n]+)/;
const TF_ON_LINE_REGEX = /on\s+([^\s]+)\s+line\s+(\d+)/;

/**
 * Parses Terraform errors.
 *
 * @param {string} text
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
export function parseTerraformDiagnostic(text) {
  if (!text || typeof text !== 'string') return null;

  const errorMatch = text.match(TF_ERROR_REGEX);
  if (!errorMatch) return null;

  const message = errorMatch[1].trim();
  const onLineMatch = text.match(TF_ON_LINE_REGEX);

  let sourceFile = null;
  let line = null;

  if (onLineMatch) {
    sourceFile = onLineMatch[1];
    line = parseInt(onLineMatch[2], 10);
  } else if (!text.includes('terraform') && !text.includes('│ Error:')) {
    // If it's just a generic "Error:" with no tf line block or terraform mentions, 
    // it's too risky to claim it as terraform.
    return null;
  }

  return createStructuredDiagnostic({
    language: 'terraform',
    runtime: 'terraform',
    errorType: 'TerraformError',
    message: message,
    sourceFile: sourceFile,
    line: line,
    confidence: ConfidenceLevel.EXACTLY_PARSED,
    rawEvidenceSnippet: errorMatch[0]
  });
}
