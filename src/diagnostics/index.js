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
 * Registry of diagnostic candidate parsers.
 * Note: Under the candidate scoring architecture, all registered parsers are evaluated,
 * eliminating brittle first-match-wins ordering hazards.
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
 * Computes an evidence score for a candidate diagnostic based on command context,
 * distinctive syntactic signatures, and source file extensions.
 *
 * Product Principle: False positive < False negative.
 * An unknown diagnostic is conservative; a wrongly classified diagnostic corrupts
 * incident fingerprinting, search, negative memory, and agent advice.
 *
 * @param {import('./model.js').StructuredDiagnostic} diag
 * @param {string} text
 * @param {object} context
 * @returns {number}
 */
export function scoreDiagnosticCandidate(diag, text, context = {}) {
  if (!diag || !diag.language) return 0;

  let score = 0;
  const cmd = typeof context.command === 'string' ? context.command.trim().toLowerCase() : '';
  const lang = diag.language;

  // 1. Command context alignment & alien penalties
  if (cmd) {
    const isTfCmd = /(?:^|[\\/])(?:terraform|tofu)(?:\.exe)?(?:\s|$)/.test(cmd);
    const isAwsCmd = /(?:^|[\\/])aws(?:\.exe)?(?:\s|$)/.test(cmd);
    const isKubeCmd = /(?:^|[\\/])(?:kubectl|k8s|minikube|helm|oc)(?:\.exe)?(?:\s|$)/.test(cmd);
    const isJavaCmd = /(?:^|[\\/])(?:java|javac|mvn|gradle|gradlew)(?:\.exe)?(?:\s|$)/.test(cmd);
    const isNodeCmd = /(?:^|[\\/])(?:node|npm|npx|yarn|pnpm|bun)(?:\.exe)?(?:\s|$)/.test(cmd);
    const isPyCmd = /(?:^|[\\/])(?:python|python3|pytest|pip|poetry|uv)(?:\.exe)?(?:\s|$)/.test(cmd);
    const isRustCmd = /(?:^|[\\/])(?:cargo|rustc)(?:\.exe)?(?:\s|$)/.test(cmd);
    const isGoCmd = /(?:^|[\\/])go(?:\.exe)?(?:\s|$)/.test(cmd);

    if (lang === 'terraform' && isTfCmd) score += 40;
    else if (lang === 'aws-cli' && isAwsCmd) score += 40;
    else if (lang === 'kubernetes' && isKubeCmd) score += 40;
    else if (lang === 'java' && isJavaCmd) score += 40;
    else if (lang === 'node' && isNodeCmd) score += 40;
    else if (lang === 'python' && isPyCmd) score += 40;
    else if (lang === 'rust' && isRustCmd) score += 40;
    else if (lang === 'go' && isGoCmd) score += 40;
    else {
      // Alien command penalty: If command explicitly indicates another known tool, penalize mismatch
      if ((isTfCmd && lang !== 'terraform') ||
          (isAwsCmd && lang !== 'aws-cli') ||
          (isKubeCmd && lang !== 'kubernetes') ||
          (isNodeCmd && lang !== 'node') ||
          (isPyCmd && lang !== 'python') ||
          (isRustCmd && lang !== 'rust') ||
          (isGoCmd && lang !== 'go') ||
          (isJavaCmd && lang !== 'java')) {
        score -= 40;
      }
    }
  }

  // 2. Distinctive syntactic signatures
  if (lang === 'terraform') {
    if (text.includes('│ Error:') || /│\s*Error:/m.test(text) || text.includes('╷') || text.includes('╵')) {
      score += 40;
    } else if (/\bError:\s*[^\r\n]+/i.test(text) && diag.sourceFile && /\.(?:tf|tfvars|tofu)$/i.test(diag.sourceFile)) {
      score += 35;
    }
  } else if (lang === 'kubernetes') {
    if (/Error from server \([^)]+\):/i.test(text)) {
      score += 40;
    }
    if (/The connection to the server .* was refused - did you specify the right host or port/i.test(text)) {
      score += 35;
    }
  } else if (lang === 'aws-cli') {
    if (/An error occurred \([^)]+\) when calling the/i.test(text)) {
      score += 40;
    }
    if (/fatal error:\s*(?:Unable to locate credentials|The config profile)/i.test(text)) {
      score += 35;
    }
  } else if (lang === 'java') {
    if (/Exception in thread \"[^\"]+\"/i.test(text)) {
      score += 35;
    }
    if (Array.isArray(diag.stackFrames) && diag.stackFrames.length > 0) {
      score += 25;
    }
    if (diag.nestedCause) {
      score += 15;
    }
  } else if (lang === 'python') {
    if (text.includes('Traceback (most recent call last):')) {
      score += 40;
    }
  } else if (lang === 'rust') {
    if (/error\[E\d+\]:/.test(text) || /-->\s*.*:\d+:\d+/.test(text)) {
      score += 40;
    }
  } else if (lang === 'go') {
    if (text.includes('panic:') || /goroutine \d+ \[running\]:/.test(text)) {
      score += 40;
    }
  } else if (lang === 'node') {
    if (text.includes('node:internal') || (Array.isArray(diag.stackFrames) && diag.stackFrames.some(f => f.file && f.file.startsWith('node:')))) {
      score += 40;
    } else if (Array.isArray(diag.stackFrames) && diag.stackFrames.length > 0) {
      score += 25;
    }
    if (diag.errorCode && /^ERR_[A-Z0-9_]+$/.test(diag.errorCode)) {
      score += 35;
    }
  }

  // 3. Source file extension checks
  if (diag.sourceFile) {
    const file = diag.sourceFile.toLowerCase();
    if (lang === 'terraform') {
      if (/\.(?:tf|tfvars|tf\.json|tofu)$/.test(file)) score += 30;
      else score -= 50; // Non-Terraform file extension claimed by Terraform parser
    } else if (lang === 'java') {
      if (/\.(?:java|kt|scala|groovy)$/.test(file)) score += 25;
    } else if (lang === 'node') {
      if (/\.(?:js|ts|mjs|cjs|jsx|tsx)$/.test(file)) score += 25;
    } else if (lang === 'python') {
      if (/\.py$/.test(file)) score += 25;
    } else if (lang === 'rust') {
      if (/\.rs$/.test(file)) score += 25;
    } else if (lang === 'go') {
      if (/\.go$/.test(file)) score += 25;
    }
  }

  // 4. Base extraction confidence bonus
  if (diag.confidence === ConfidenceLevel.EXACTLY_PARSED) {
    score += 15;
  } else if (diag.confidence === ConfidenceLevel.INFERRED) {
    score += 5;
  }

  return score;
}

/**
 * Creates an empty StructuredDiagnostic object for missing or whitespace-only error text.
 *
 * @returns {import('./model.js').StructuredDiagnostic}
 */
function createEmptyDiagnostic() {
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

/**
 * Creates an unclassified fallback StructuredDiagnostic object.
 *
 * @param {string} text
 * @returns {import('./model.js').StructuredDiagnostic}
 */
function createUnknownDiagnostic(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim().length > 0) || '';

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
    rawEvidenceSnippet: text.slice(0, 300).trim()
  });
}

/**
 * Evaluates candidate diagnostic parsers using evidence scoring, returning the
 * highest-scoring candidate above the confidence threshold, or abstaining to UNKNOWN
 * if ambiguous or poorly evidenced.
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
    return createEmptyDiagnostic();
  }

  // 2. Collect candidate diagnostics across all registered parsers against primary text
  const candidates = [];
  for (const { name, parse } of PARSER_REGISTRY) {
    try {
      const diag = parse(primaryText, context);
      if (diag && diag.language) {
        const score = scoreDiagnosticCandidate(diag, primaryText, context);
        candidates.push({ name, diag, score });
      }
    } catch {
      // Individual parser failed: continue evaluating others
    }
  }

  // 3. Fallback to stdout if stderr had no credible match
  if (candidates.length === 0 && stderr.trim().length > 0 && stdout.trim().length > 0 && primaryText !== stdout) {
    for (const { name, parse } of PARSER_REGISTRY) {
      try {
        const diag = parse(stdout, context);
        if (diag && diag.language) {
          const score = scoreDiagnosticCandidate(diag, stdout, context);
          candidates.push({ name, diag, score });
        }
      } catch {
        // Continue
      }
    }
  }

  // 4. Filter credible candidates by evidence threshold (minimum score 35)
  const credibleCandidates = candidates.filter(c => c.score >= 35);
  credibleCandidates.sort((a, b) => b.score - a.score);

  if (credibleCandidates.length === 0) {
    return createUnknownDiagnostic(primaryText);
  }

  const top = credibleCandidates[0];
  const runnerUp = credibleCandidates.length > 1 ? credibleCandidates[1] : null;

  // 5. Collision policy: If runner-up has a different language and score is within 5 points,
  // evidence is ambiguous -> abstain to UNKNOWN ("False positive < false negative")
  if (runnerUp && runnerUp.diag.language !== top.diag.language && Math.abs(top.score - runnerUp.score) <= 5) {
    return createUnknownDiagnostic(primaryText);
  }

  // 6. Calibrate extraction confidence based on evidence score
  if (top.score >= 50 && top.diag.confidence === ConfidenceLevel.EXACTLY_PARSED) {
    return top.diag;
  }

  if (top.score < 50 && top.diag.confidence === ConfidenceLevel.EXACTLY_PARSED) {
    return createStructuredDiagnostic({
      ...top.diag,
      confidence: ConfidenceLevel.INFERRED
    });
  }

  return top.diag;
}
