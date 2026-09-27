import { ConfidenceLevel, createStructuredDiagnostic } from '../model.js';

// Matches:
// "Exception in thread "main" java.lang.NullPointerException: message"
// or "java.lang.IllegalArgumentException: message"
// or "org.springframework.beans.factory.BeanCreationException: message"
const JAVA_EXCEPTION_HEADER_REGEX = /(?:Exception in thread \"[^\"]+\"\s+)?([a-zA-Z0-9_.$]+(?:Exception|Error))(?::\s*(.*))?/;

/**
 * Parses a single Java stack frame line in stages.
 * Examples:
 *   "at com.example.MyClass.myMethod(MyClass.java:42)"
 *   "at java.base/java.lang.Thread.run(Thread.java:829)"
 *   "at java.base@21/java.lang.Thread.run(Thread.java:829)"
 *   "at app//com.example.App.main(App.java:10)"
 *   "at com.example.MyClass.<init>(MyClass.java:15)"
 *   "at com.example.MyClass.nativeMethod(Native Method)"
 *   "at com.example.MyClass.unknownMethod(Unknown Source)"
 *
 * @param {string} line
 * @returns {object | null}
 */
function parseJavaStackFrame(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith('at ')) return null;

  const content = trimmed.slice(3).trim();
  const openParenIdx = content.lastIndexOf('(');
  const closeParenIdx = content.lastIndexOf(')');

  if (openParenIdx === -1 || closeParenIdx === -1 || closeParenIdx <= openParenIdx) {
    return null;
  }

  const rawTarget = content.slice(0, openParenIdx).trim();
  const rawLocation = content.slice(openParenIdx + 1, closeParenIdx).trim();

  // 1. Process target (optional module/classloader prefix + class.method)
  let functionName = rawTarget;
  let moduleName = null;

  const slashIdx = rawTarget.lastIndexOf('/');
  if (slashIdx !== -1) {
    moduleName = rawTarget.slice(0, slashIdx);
    functionName = rawTarget.slice(slashIdx + 1);
  }

  // 2. Process location inside parentheses
  let file = null;
  let lineNum = null;

  if (rawLocation === 'Native Method' || rawLocation === 'Unknown Source') {
    file = null;
    lineNum = null;
  } else {
    const colonIdx = rawLocation.lastIndexOf(':');
    if (colonIdx !== -1) {
      file = rawLocation.slice(0, colonIdx).trim();
      const parsedLine = parseInt(rawLocation.slice(colonIdx + 1).trim(), 10);
      lineNum = Number.isNaN(parsedLine) ? null : parsedLine;
    } else if (rawLocation.length > 0) {
      file = rawLocation.trim();
    }
  }

  return {
    function: functionName,
    module: moduleName,
    file,
    line: lineNum,
    column: null,
    raw: trimmed
  };
}

/**
 * Internal parser that extracts a single Java exception block and any stack frames.
 *
 * @param {string} text
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
function parseSingleJavaBlock(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split(/\r?\n/);
  let headerMatch = null;
  let headerIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = line.match(JAVA_EXCEPTION_HEADER_REGEX);
    if (m) {
      headerMatch = m;
      headerIndex = i;
      break;
    }
  }

  if (!headerMatch) return null;

  const errorType = headerMatch[1];
  const message = headerMatch[2] ? headerMatch[2].trim() : '';

  const stackFrames = [];
  let hasJavaSourceFile = false;
  let hasModulePrefix = false;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const frame = parseJavaStackFrame(line);
    if (frame) {
      if (frame.file && /\.(?:java|kt|scala|groovy)$/i.test(frame.file)) {
        hasJavaSourceFile = true;
      }
      if (frame.module && (frame.module.startsWith('java.') || frame.module.startsWith('jdk.') || frame.module.includes('/'))) {
        hasModulePrefix = true;
      }
      stackFrames.push(frame);
    } else if (line.trim().startsWith('... ') || line.trim().startsWith('Caused by:')) {
      break;
    }
  }

  const hasThreadIndicator = text.includes('Exception in thread');
  if (!hasThreadIndicator && !hasJavaSourceFile && !hasModulePrefix && stackFrames.length === 0) {
    return null;
  }

  const primaryFrame = stackFrames.find(f => f.file && f.line) || stackFrames[0];

  return createStructuredDiagnostic({
    language: 'java',
    runtime: 'jvm',
    errorType,
    errorCode: null,
    message: message || null,
    sourceFile: primaryFrame ? primaryFrame.file : null,
    line: primaryFrame ? primaryFrame.line : null,
    stackFrames,
    confidence: ConfidenceLevel.EXACTLY_PARSED,
    rawEvidenceSnippet: headerMatch[0]
  });
}

/**
 * Parses Java exceptions, stack traces (including modern module-qualified frames),
 * and chained causes ("Caused by:").
 *
 * @param {string} text
 * @param {object} [context={}]
 * @returns {import('../model.js').StructuredDiagnostic | null}
 */
export function parseJavaDiagnostic(text, context = {}) {
  if (!text || typeof text !== 'string') return null;

  const isJavaCommand = Boolean(context.command && /(?:^|[\\/])(?:java|javac|mvn|gradle|gradlew)(?:\.exe)?(?:\s|$)/i.test(context.command));

  // Split on "Caused by:" boundaries to parse chained causes
  const causedByParts = text.split(/(?:\r?\n|^)Caused by:\s*/);
  const primaryText = causedByParts[0];

  const primaryDiag = parseSingleJavaBlock(primaryText);
  if (!primaryDiag) {
    // If primary text didn't match directly, but command is java, attempt parsing the full block
    if (isJavaCommand) {
      return parseSingleJavaBlock(text);
    }
    return null;
  }

  // Parse nested cause if present
  let nestedCause = null;
  if (causedByParts.length > 1) {
    const causeText = causedByParts.slice(1).join('\nCaused by: ');
    nestedCause = parseSingleJavaBlock(causeText);
  }

  if (nestedCause) {
    return createStructuredDiagnostic({
      ...primaryDiag,
      nestedCause
    });
  }

  return primaryDiag;
}
