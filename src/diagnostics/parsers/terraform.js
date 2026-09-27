import { ConfidenceLevel, createStructuredDiagnostic } from '../model.js';

const TF_BOX_MARKER_REGEX = /(?:^|\n)\s*[│╷╵]\s*(?:Error|Warning):\s*([^\r\n]+)/;
const TF_STANDARD_ERROR_REGEX = /(?:^|\n)\s*Error:\s*([^\r\n]+)/;
const TF_ON_LINE_REGEX = /(?:on\s+([^\s]+)\s+line\s+(\d+)|([^\s:]+\.tf(?:vars)?):(\d+))/;
const TF_FILE_EXTENSION_REGEX = /\.(?:tf|tfvars|tf\.json|tofu)$/i;

/**
 * Parses Terraform / OpenTofu diagnostics with strict evidence gating.
 *
 * @param {string} text
 * @param {object} [context={}]
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
export function parseTerraformDiagnostic(text, context = {}) {
  if (!text || typeof text !== 'string') return null;

  const isTfCommand = Boolean(context.command && /(?:^|[\\/])(?:terraform|tofu)(?:\.exe)?(?:\s|$)/i.test(context.command));
  const hasBoxMarker = Boolean(text.includes('│ Error:') || text.includes('╷') || text.includes('╵') || /│\s*Error:/m.test(text));
  const hasTfKeyword = Boolean(/\b(?:terraform|tofu|hcl)\b/i.test(text));

  const boxMatch = text.match(TF_BOX_MARKER_REGEX);
  const stdMatch = text.match(TF_STANDARD_ERROR_REGEX);
  const errorMatch = boxMatch || stdMatch;

  if (!errorMatch) return null;

  const onLineMatch = text.match(TF_ON_LINE_REGEX);
  let sourceFile = null;
  let line = null;
  let hasTfExtension = false;

  if (onLineMatch) {
    sourceFile = onLineMatch[1] || onLineMatch[3] || null;
    const lineStr = onLineMatch[2] || onLineMatch[4] || null;
    line = lineStr ? parseInt(lineStr, 10) : null;
    if (sourceFile && TF_FILE_EXTENSION_REGEX.test(sourceFile)) {
      hasTfExtension = true;
    }
  }

  // Reject immediately if sourceFile points to a non-Terraform source file
  // unless there are unmistakable Terraform box markers or a verified terraform command
  if (sourceFile && !hasTfExtension && /\.(?:js|ts|py|rs|go|c|cpp|java|rb|php|html|css|json)$/i.test(sourceFile) && !isTfCommand && !hasBoxMarker) {
    return null;
  }

  // Evidence gates: must have at least one strong or distinctive signal
  if (!isTfCommand && !hasBoxMarker && !hasTfExtension && !hasTfKeyword) {
    return null;
  }

  const message = errorMatch[1].trim();
  const isExact = isTfCommand || hasBoxMarker || hasTfExtension;

  return createStructuredDiagnostic({
    language: 'terraform',
    runtime: 'terraform',
    errorType: 'TerraformError',
    message,
    sourceFile: hasTfExtension || isTfCommand ? sourceFile : null,
    line: hasTfExtension || isTfCommand ? line : null,
    confidence: isExact ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.INFERRED,
    rawEvidenceSnippet: errorMatch[0].trim()
  });
}
