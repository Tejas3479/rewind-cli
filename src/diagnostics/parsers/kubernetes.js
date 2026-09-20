
import { ConfidenceLevel, createStructuredDiagnostic } from '../model.js';

const KUBE_SERVER_ERROR_REGEX = /Error from server \(([^)]+)\):\s*(.*)/;
const KUBE_LOCAL_ERROR_REGEX = /^error:\s*(.*)/m;
const KUBE_CONNECTION_REFUSED_REGEX = /The connection to the server .* was refused/;

/**
 * Parses kubectl / kubernetes errors.
 *
 * @param {string} text
 * @param {object} [context={}]
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
export function parseKubernetesDiagnostic(text, context = {}) {
  if (!text || typeof text !== 'string') return null;

  const serverMatch = text.match(KUBE_SERVER_ERROR_REGEX);
  if (serverMatch) {
    return createStructuredDiagnostic({
      language: 'kubernetes',
      runtime: 'kubectl',
      errorType: 'ServerError',
      errorCode: serverMatch[1],
      message: serverMatch[2].trim(),
      confidence: ConfidenceLevel.EXACTLY_PARSED,
      rawEvidenceSnippet: serverMatch[0]
    });
  }

  const localMatch = text.match(KUBE_LOCAL_ERROR_REGEX);
  const isKubeContext = (context.command && /kubectl|k8s|minikube|helm/i.test(context.command)) ||
    /\b(kubectl|kubernetes|cluster|pod|deployment|namespace)\b/i.test(text);

  if (localMatch && isKubeContext) {
    return createStructuredDiagnostic({
      language: 'kubernetes',
      runtime: 'kubectl',
      errorType: 'ClientError',
      message: localMatch[1].trim(),
      confidence: ConfidenceLevel.EXACTLY_PARSED,
      rawEvidenceSnippet: localMatch[0]
    });
  }

  const connMatch = text.match(KUBE_CONNECTION_REFUSED_REGEX);
  if (connMatch) {
    return createStructuredDiagnostic({
      language: 'kubernetes',
      runtime: 'kubectl',
      errorType: 'ConnectionError',
      errorCode: 'ECONNREFUSED',
      message: connMatch[0],
      confidence: ConfidenceLevel.EXACTLY_PARSED,
      rawEvidenceSnippet: connMatch[0]
    });
  }

  return null;
}
