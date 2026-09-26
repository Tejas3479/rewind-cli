import { computeFingerprint } from './fingerprint.js';

export const CaptureClassification = Object.freeze({
  DISCARD: 'DISCARD',
  OBSERVE: 'OBSERVE',
  PROMOTE: 'PROMOTE'
});

/**
 * Evaluates a command capture result and classifies it into three tiers:
 * - DISCARD: Ephemeral noise or intentional user aborts (never stored).
 * - OBSERVE: Lightweight observation stored with TTL; promoted if recurrent.
 * - PROMOTE: Full durable incident in the ledger.
 *
 * @param {import('../capture.js').CaptureRecord} captureResult
 * @param {import('./store.js').StorageEngine} [storage]
 * @param {'shell_hook' | 'rewind_run' | 'agent_event'} [source='shell_hook']
 * @returns {'DISCARD' | 'OBSERVE' | 'PROMOTE'}
 */
export function classifyCapture(captureResult, storage = null, source = 'shell_hook') {
  if (!captureResult) {
    return CaptureClassification.DISCARD;
  }

  // 1. Successful commands (exit code 0) are never failure incidents
  if (captureResult.success || captureResult.exitCode === 0) {
    return CaptureClassification.DISCARD;
  }

  // 2. Explicit `rewind run <cmd>`: User explicitly instructed Rewind to record this execution
  if (source === 'rewind_run') {
    return CaptureClassification.PROMOTE;
  }

  const exitCode = typeof captureResult.exitCode === 'number' ? captureResult.exitCode : null;
  const signal = captureResult.signal ? String(captureResult.signal).toUpperCase() : null;

  // 3. User cancellation (SIGINT / Ctrl+C / exit code 130) -> DISCARD
  if (exitCode === 130 || signal === 'SIGINT') {
    return CaptureClassification.DISCARD;
  }

  // 4. Critical resource exhaustion (SIGKILL / OOM / exit code 137) -> PROMOTE
  if (exitCode === 137 || signal === 'SIGKILL') {
    return CaptureClassification.PROMOTE;
  }

  // Compute or extract fingerprint
  const computed = computeFingerprint({
    command: captureResult.command || '',
    args: captureResult.args || [],
    exitCode: captureResult.exitCode,
    signal: captureResult.signal,
    stderr: captureResult.stderr || '',
    stdout: captureResult.stdout || ''
  });
  const fingerprint = captureResult.fingerprint || computed.fingerprint;

  // 5. Existing incident match in ledger -> PROMOTE (Known failure family recurring)
  if (storage && typeof storage.findByFingerprint === 'function') {
    const existingIncidents = storage.findByFingerprint(fingerprint);
    if (existingIncidents && existingIncidents.length > 0) {
      return CaptureClassification.PROMOTE;
    }
  }

  // 6. Recurrence check: Prior observation exists within window (default 30 min) -> PROMOTE
  if (storage && typeof storage.shouldPromoteObservation === 'function') {
    if (storage.shouldPromoteObservation(fingerprint)) {
      return CaptureClassification.PROMOTE;
    }
  }

  // Check for command not found or ENOENT (these are always OBSERVE on first occurrence)
  const stderr = captureResult.stderr || captureResult.stderrRaw || '';
  const isCommandNotFound = exitCode === 127 ||
    /command not found/i.test(stderr) ||
    /is not recognized as an internal or external command/i.test(stderr);
  if (isCommandNotFound) {
    return CaptureClassification.OBSERVE;
  }

  const isFileNotFound = /ENOENT/i.test(stderr) ||
    /no such file or directory/i.test(stderr) ||
    /cannot find file/i.test(stderr);
  if (isFileNotFound) {
    return CaptureClassification.OBSERVE;
  }

  // 7. Test runner failures (e.g. pytest, jest, vitest, npm test, cargo test) -> PROMOTE
  const fullCmd = (captureResult.fullCommand || `${captureResult.command || ''} ${(captureResult.args || []).join(' ')}`).toLowerCase();
  const isTestCommand = /^(pytest|jest|vitest|mocha|cargo\s+test|npm\s+test|go\s+test)\b/.test(fullCmd) ||
    /\b(pytest|jest|vitest|mocha)\b/.test((captureResult.command || '').toLowerCase());
  if (isTestCommand) {
    return CaptureClassification.PROMOTE;
  }

  // 8. Structured diagnostic: high-signal engineering failures -> PROMOTE
  const diag = captureResult.diagnostic;
  if (diag) {
    // Runtime crash with stack trace
    const hasStackTrace = Array.isArray(diag.stackFrames) && diag.stackFrames.length > 0;
    // Compiler / build error with file:line location
    const hasFileLine = Boolean(diag.sourceFile && diag.line);
    // Exactly parsed language runtime error (e.g. TypeError, AssertionError, panic)
    const isParsedLanguageError = Boolean(
      diag.language &&
      diag.errorType &&
      diag.errorType !== 'CommandNotFound' &&
      diag.errorType !== 'FileNotFound'
    );

    if (hasStackTrace || hasFileLine || isParsedLanguageError) {
      return CaptureClassification.PROMOTE;
    }
  }

  // 8. Default for passive shell capture -> OBSERVE
  return CaptureClassification.OBSERVE;
}
