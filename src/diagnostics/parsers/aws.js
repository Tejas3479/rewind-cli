import { ConfidenceLevel, createStructuredDiagnostic } from '../model.js';

// Standard / Enhanced AWS CLI format:
// "An error occurred (ResourceNotFoundException) when calling the GetFunction operation: Function not found: arn:..."
// or "An error occurred (AccessDenied) when calling the GetObject operation: Access Denied"
const AWS_STANDARD_ERROR_REGEX = /An error occurred \(([^)]+)\) when calling the ([A-Za-z0-9_]+) operation:\s*([\s\S]*)/;

// AWS CLI-level credential, profile, argument, and endpoint errors:
const AWS_FATAL_CREDENTIAL_REGEX = /fatal error:\s*(Unable to locate credentials(?:\.|\b.*)?)/i;
const AWS_FATAL_PROFILE_REGEX = /fatal error:\s*(The config profile \(([^)]+)\) could not be found.*)/i;
const AWS_CLI_ARG_ERROR_REGEX = /(?:usage:\s*aws[^\n]*\n)?aws:\s*error:\s*(.*)/i;
const AWS_ENDPOINT_ERROR_REGEX = /Could not connect to the endpoint URL:\s*["']?([^"'\s]+)["']?/i;

/**
 * Attempts to parse AWS CLI JSON error output:
 * { "Error": { "Code": "AccessDenied", "Message": "Access Denied" } }
 * or { "Code": "NoSuchBucket", "Message": "..." }
 *
 * @param {string} text
 * @returns {{ code: string, message: string } | null}
 */
function tryParseAwsJsonError(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const data = JSON.parse(trimmed);
    if (data.Error && (data.Error.Code || data.Error.Message)) {
      return {
        code: data.Error.Code || 'AwsError',
        message: data.Error.Message || ''
      };
    }
    if (data.Code && data.Message) {
      return {
        code: data.Code,
        message: data.Message
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

/**
 * Parses AWS CLI diagnostics across enhanced, legacy, JSON, and CLI-level error formats.
 * Note: Python/Boto3 tracebacks (e.g. botocore.exceptions.ClientError) are intentionally
 * not handled here and remain delegated to the Python diagnostic parser.
 *
 * @param {string} text
 * @param {object} [context={}]
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
export function parseAwsDiagnostic(text, context = {}) {
  if (!text || typeof text !== 'string') return null;

  const isAwsCommand = Boolean(context.command && /(?:^|[\\/])aws(?:\.exe)?(?:\s|$)/i.test(context.command));

  // 1. Standard / Enhanced format: "An error occurred (Code) when calling the Operation operation: Message"
  const stdMatch = text.match(AWS_STANDARD_ERROR_REGEX);
  if (stdMatch) {
    const errorCode = stdMatch[1].trim();
    const operation = stdMatch[2].trim();
    const rawMessage = stdMatch[3].trim();
    const firstLineMessage = rawMessage.split(/\r?\n/)[0].trim();

    return createStructuredDiagnostic({
      language: 'aws-cli',
      runtime: 'aws',
      errorType: errorCode,      // Error class: AccessDenied, ResourceNotFoundException, etc.
      errorCode: errorCode,      // Error code: AccessDenied, etc.
      operation: operation,      // Dedicated operation field: GetObject, GetFunction, etc.
      message: firstLineMessage || rawMessage,
      confidence: ConfidenceLevel.EXACTLY_PARSED,
      rawEvidenceSnippet: stdMatch[0].slice(0, 300).trim()
    });
  }

  // 2. JSON error response
  const jsonError = tryParseAwsJsonError(text);
  if (jsonError) {
    return createStructuredDiagnostic({
      language: 'aws-cli',
      runtime: 'aws',
      errorType: jsonError.code,
      errorCode: jsonError.code,
      operation: null,
      message: jsonError.message,
      confidence: isAwsCommand ? ConfidenceLevel.EXACTLY_PARSED : ConfidenceLevel.INFERRED,
      rawEvidenceSnippet: text.slice(0, 300).trim()
    });
  }

  // 3. CLI-level credential errors
  const credMatch = text.match(AWS_FATAL_CREDENTIAL_REGEX);
  if (credMatch && (isAwsCommand || /aws/i.test(text))) {
    return createStructuredDiagnostic({
      language: 'aws-cli',
      runtime: 'aws',
      errorType: 'NoCredentialsError',
      errorCode: 'NoCredentials',
      operation: null,
      message: credMatch[1].trim(),
      confidence: ConfidenceLevel.EXACTLY_PARSED,
      rawEvidenceSnippet: credMatch[0]
    });
  }

  // 4. CLI-level profile errors
  const profileMatch = text.match(AWS_FATAL_PROFILE_REGEX);
  if (profileMatch && (isAwsCommand || /aws/i.test(text))) {
    return createStructuredDiagnostic({
      language: 'aws-cli',
      runtime: 'aws',
      errorType: 'ProfileNotFound',
      errorCode: 'ProfileNotFound',
      operation: null,
      message: profileMatch[1].trim(),
      confidence: ConfidenceLevel.EXACTLY_PARSED,
      rawEvidenceSnippet: profileMatch[0]
    });
  }

  // 5. CLI argument / syntax errors
  const cliArgMatch = text.match(AWS_CLI_ARG_ERROR_REGEX);
  if (cliArgMatch && isAwsCommand) {
    return createStructuredDiagnostic({
      language: 'aws-cli',
      runtime: 'aws',
      errorType: 'CliArgumentError',
      errorCode: 'InvalidParameter',
      operation: null,
      message: cliArgMatch[1].trim(),
      confidence: ConfidenceLevel.EXACTLY_PARSED,
      rawEvidenceSnippet: cliArgMatch[0]
    });
  }

  // 6. Endpoint connection errors
  const endpointMatch = text.match(AWS_ENDPOINT_ERROR_REGEX);
  if (endpointMatch && (isAwsCommand || /amazonaws\.com/i.test(text))) {
    return createStructuredDiagnostic({
      language: 'aws-cli',
      runtime: 'aws',
      errorType: 'EndpointConnectionError',
      errorCode: 'EndpointConnectionError',
      operation: null,
      message: endpointMatch[0].trim(),
      confidence: ConfidenceLevel.EXACTLY_PARSED,
      rawEvidenceSnippet: endpointMatch[0]
    });
  }

  return null;
}
