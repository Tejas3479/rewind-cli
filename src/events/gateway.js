import { tokenizeCommandLine } from '../parser.js';
import { redactSecrets, sanitizeForDisplay } from '../sanitizer.js';
import { parseDiagnostic } from '../diagnostics/index.js';
import { captureSafeEnvironment } from '../environment.js';
import { readGitMetadata } from '../git.js';
import { classifyCapture, CaptureClassification } from '../storage/capture_policy.js';

/**
 * Normalizes vendor-specific agent payloads (Cursor, Gemini, Codex, Generic)
 * into a uniform RewindEvent structure.
 *
 * @param {object|string} rawPayload
 * @param {object} [contextOptions]
 * @returns {object} Normalized RewindEvent
 */
export function normalizeEvent(rawPayload, contextOptions = {}) {
  let data = rawPayload;
  if (typeof rawPayload === 'string') {
    try {
      data = JSON.parse(rawPayload);
    } catch {
      data = { rawText: rawPayload };
    }
  }

  data = data && typeof data === 'object' ? data : {};

  let source = 'generic';
  let sessionId = null;
  let toolName = null;
  let rawCmd = '';
  let cwd = contextOptions.cwd || data.cwd || process.cwd();
  let exitCode = 1;
  let signal = null;
  let durationMs = 0;
  let stderr = '';
  let stdout = '';

  // 1. Detect Cursor hook payload (has conversation_id or tool_input or tool_output)
  if (data.conversation_id || data.tool_input || data.tool_output) {
    source = 'cursor';
    sessionId = data.conversation_id || null;
    toolName = data.tool_name || null;
    const input = data.tool_input || {};
    rawCmd = input.command || input.cmd || data.command || '';
    cwd = input.cwd || cwd;
    const output = data.tool_output || {};
    exitCode = typeof output.exit_code === 'number' ? output.exit_code : (typeof data.exitCode === 'number' ? data.exitCode : 1);
    stderr = output.stderr || data.error || '';
    stdout = output.stdout || '';
    durationMs = typeof data.duration_ms === 'number' ? data.duration_ms : 0;
  }
  // 2. Detect Gemini CLI hook payload (has session_id or parameters or hookSpecificOutput)
  else if (data.hookSpecificOutput || data.session_id || data.parameters || (data.result && data.tool_name)) {
    source = 'gemini';
    sessionId = data.session_id || null;
    toolName = data.tool_name || null;
    const params = data.parameters || {};
    rawCmd = params.command || params.cmd || data.command || '';
    cwd = params.cwd || cwd;
    const res = data.result || {};
    exitCode = typeof res.exit_code === 'number' ? res.exit_code : (typeof data.exitCode === 'number' ? data.exitCode : 1);
    stderr = res.error || res.stderr || data.error || '';
    stdout = res.stdout || '';
  }
  // 3. Detect Codex hook payload
  else if (data.tool || (data.input && data.output)) {
    source = 'codex';
    toolName = data.tool || null;
    const input = data.input || {};
    rawCmd = input.command || input.cmd || data.command || '';
    cwd = input.cwd || cwd;
    const output = data.output || {};
    exitCode = typeof output.exitCode === 'number' ? output.exitCode : (typeof output.exit_code === 'number' ? output.exit_code : 1);
    stderr = output.stderr || data.error || '';
    stdout = output.stdout || '';
  }
  // 4. Generic / Direct Rewind payload
  else {
    source = data.source || 'generic';
    sessionId = data.sessionId || null;
    toolName = data.toolName || null;
    rawCmd = data.command || data.fullCommand || data.cmd || '';
    cwd = data.cwd || cwd;
    exitCode = typeof data.exitCode === 'number' ? data.exitCode : 1;
    signal = data.signal || null;
    durationMs = typeof data.durationMs === 'number' ? data.durationMs : 0;
    stderr = data.stderr || data.error || '';
    stdout = data.stdout || '';
  }

  // Tokenize command line
  const trimmedCmd = String(rawCmd).trim();
  const tokens = trimmedCmd ? tokenizeCommandLine(trimmedCmd) : [];
  const executable = tokens[0] || trimmedCmd;
  const args = tokens.slice(1);

  // Apply strict privacy redaction
  const fullCommandSanitized = redactSecrets(trimmedCmd);
  const argsSanitized = args.map((a) => redactSecrets(a));
  const stderrSanitized = sanitizeForDisplay(stderr);
  const stdoutSanitized = sanitizeForDisplay(stdout);

  const safeEnv = captureSafeEnvironment();
  const gitMeta = readGitMetadata(cwd);
  const diagnostic = parseDiagnostic(stderrSanitized || stderr, stdoutSanitized || stdout, { command: executable, cwd });

  const nowIso = new Date().toISOString();
  const startTimeIso = new Date(Date.now() - durationMs).toISOString();

  return {
    source,
    sessionId,
    toolName,
    command: executable,
    args: argsSanitized,
    fullCommand: fullCommandSanitized,
    cwd,
    startTime: startTimeIso,
    endTime: nowIso,
    durationMs,
    exitCode,
    signal,
    timedOut: false,
    success: exitCode === 0,
    stdoutRaw: '',
    stderrRaw: stderr,
    stdout: stdoutSanitized,
    stderr: stderrSanitized,
    diagnostic,
    isTruncated: false,
    git: gitMeta,
    environment: safeEnv,
    timestamp: nowIso
  };
}

/**
 * Formats structured additionalContext text for agent context injection.
 *
 * @param {import('../storage/surfacing.js').SurfacingDecision} decision
 * @param {string} [incidentId]
 * @returns {string|null}
 */
export function formatAgentAdditionalContext(decision, incidentId = '') {
  if (!decision || decision.action === 'SILENCE') {
    return null;
  }

  const parts = [];

  if (decision.action === 'SURFACE' && decision.bestCandidate) {
    const fix = decision.bestCandidate;
    parts.push(`[Rewind Verified Fix]`);
    parts.push(`Known failure matches verified recovery from Incident #${fix.incidentId}:`);
    if (fix.cause) parts.push(`Cause: ${fix.cause}`);
    if (fix.change) parts.push(`Verified Fix: ${fix.change}`);
    if (fix.verifyCmd) parts.push(`Verification Command: ${fix.verifyCmd}`);

    if (decision.relevantFailedApproaches && decision.relevantFailedApproaches.length > 0) {
      parts.push(`\nKnown Failed Approaches (DO NOT RETRY):`);
      for (const fa of decision.relevantFailedApproaches) {
        parts.push(`- Avoid: "${fa.change}" (Failed)`);
      }
    }
    parts.push(`\nImportant: Verification commands require host/user execution approval.`);
  } else if (decision.action === 'CAUTION') {
    parts.push(`[Rewind Advisory]`);
    parts.push(`Historical failure match detected with caution: ${decision.reason}.`);
    if (decision.bestCandidate?.change) {
      parts.push(`Past candidate fix: ${decision.bestCandidate.change} (Caveat: ${decision.reason})`);
    }
    if (decision.relevantFailedApproaches && decision.relevantFailedApproaches.length > 0) {
      parts.push(`Known Failed Approaches (DO NOT RETRY):`);
      for (const fa of decision.relevantFailedApproaches) {
        parts.push(`- Avoid: "${fa.change}" (Failed)`);
      }
    }
    if (incidentId) {
      parts.push(`Run "rewind show ${incidentId}" for complete forensic evidence.`);
    }
  }

  return parts.join('\n');
}

/**
 * Processes an incoming agent event through the complete Gateway pipeline:
 * 1. Normalize vendor payload
 * 2. Classify capture (DISCARD / OBSERVE / PROMOTE)
 * 3. Store observation or incident
 * 4. Compute surfacing decision
 * 5. Return platform-compatible response JSON
 *
 * @param {object|string} rawPayload
 * @param {import('../storage/store.js').StorageEngine} storage
 * @param {object} [options]
 * @returns {object} Machine-readable gateway result
 */
export function processAgentEvent(rawPayload, storage, options = {}) {
  const start = Date.now();
  const event = normalizeEvent(rawPayload, options);

  // If command is empty or success -> DISCARD
  if (!event.command || event.success) {
    return {
      action: 'SILENCE',
      classification: CaptureClassification.DISCARD,
      matchType: 'NONE',
      durationMs: Date.now() - start,
      additionalContext: null,
      additional_context: null,
      hookSpecificOutput: { additionalContext: null }
    };
  }

  const classification = classifyCapture(event, storage, 'agent_event');

  if (classification === CaptureClassification.DISCARD) {
    return {
      action: 'SILENCE',
      classification: CaptureClassification.DISCARD,
      matchType: 'NONE',
      durationMs: Date.now() - start,
      additionalContext: null,
      additional_context: null,
      hookSpecificOutput: { additionalContext: null }
    };
  }

  if (classification === CaptureClassification.OBSERVE) {
    const obs = storage ? storage.saveObservation(event) : null;
    return {
      action: 'SILENCE',
      classification: CaptureClassification.OBSERVE,
      observationId: obs?.id || null,
      matchType: 'NONE',
      durationMs: Date.now() - start,
      additionalContext: null,
      additional_context: null,
      hookSpecificOutput: { additionalContext: null }
    };
  }

  // PROMOTE: Save full incident record and compute surfacing decision
  let savedRecord = null;
  let decision = { action: 'SILENCE', reason: '', matchType: 'NONE', bestCandidate: null, relevantFailedApproaches: [] };

  if (storage) {
    savedRecord = storage.saveRecord(event);
    decision = storage.getSurfacingDecision(savedRecord);
  }

  const contextText = formatAgentAdditionalContext(decision, savedRecord?.id);

  return {
    action: decision.action,
    classification: CaptureClassification.PROMOTE,
    incidentId: savedRecord?.id || null,
    matchType: decision.matchType,
    reason: decision.reason,
    durationMs: Date.now() - start,
    bestCandidate: decision.bestCandidate,
    relevantFailedApproaches: decision.relevantFailedApproaches,
    // Cross-platform compatibility fields for direct agent stdout output:
    additionalContext: contextText,
    additional_context: contextText,
    hookSpecificOutput: {
      additionalContext: contextText
    }
  };
}
