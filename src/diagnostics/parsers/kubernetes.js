import { ConfidenceLevel, createStructuredDiagnostic } from '../model.js';

const KUBE_SERVER_ERROR_REGEX = /Error from server \(([^)]+)\):\s*(.*)/;
const KUBE_LOCAL_ERROR_REGEX = /^error:\s*(.*)/m;
const KUBE_CONNECTION_REFUSED_REGEX = /The connection to the server .* was refused/;

/**
 * Parses kubectl / kubernetes diagnostics.
 *
 * @param {string} text
 * @param {object} [context={}]
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
export function parseKubernetesDiagnostic(text, context = {}) {
  if (!text || typeof text !== 'string') return null;

  const isKubeCommand = Boolean(context.command && /(?:^|[\\/])(?:kubectl|k8s|minikube|helm|oc)(?:\.exe)?(?:\s|$)/i.test(context.command));

  // 1. ServerError: unmistakable Kubernetes API server signature
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

  // 2. ClientError: strictly require command context (kubectl, minikube, helm, oc)
  // Stripped overly broad 'pod|cluster|deployment|namespace' word heuristics from EXACTLY_PARSED path
  const localMatch = text.match(KUBE_LOCAL_ERROR_REGEX);
  if (localMatch && isKubeCommand) {
    return createStructuredDiagnostic({
      language: 'kubernetes',
      runtime: 'kubectl',
      errorType: 'ClientError',
      message: localMatch[1].trim(),
      confidence: ConfidenceLevel.EXACTLY_PARSED,
      rawEvidenceSnippet: localMatch[0]
    });
  }

  // 3. ConnectionError: require command context OR unmistakable kubectl full phrase
  const connMatch = text.match(KUBE_CONNECTION_REFUSED_REGEX);
  const isKubeConnSignature = /The connection to the server .* was refused - did you specify the right host or port/i.test(text);
  if (connMatch && (isKubeCommand || isKubeConnSignature)) {
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
