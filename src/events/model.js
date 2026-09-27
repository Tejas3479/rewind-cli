/**
 * Canonical Event Model & Enums for Multi-Agent Gateway.
 * Strictly separates platform identity, lifecycle event type, and capture origin.
 */

export const Platform = Object.freeze({
  CURSOR: 'cursor',
  GEMINI: 'gemini',
  CODEX: 'codex',
  CLAUDE: 'claude',
  SHELL: 'shell',
  CLI: 'cli',
  GENERIC: 'generic'
});

export const EventType = Object.freeze({
  POST_TOOL_USE_FAILURE: 'PostToolUseFailure',
  AFTER_TOOL: 'AfterTool',
  POST_TOOL_USE: 'PostToolUse',
  PRE_TOOL_USE: 'PreToolUse',
  COMMAND: 'command'
});

export const CaptureOrigin = Object.freeze({
  AGENT_EVENT: 'agent_event',
  SHELL_HOOK: 'shell_hook',
  REWIND_RUN: 'rewind_run'
});

export const FailureKind = Object.freeze({
  EXECUTION_FAILURE: 'EXECUTION_FAILURE',
  TIMEOUT: 'TIMEOUT',
  INTERRUPTED: 'INTERRUPTED',
  PRE_EXECUTION_DENIED: 'PRE_EXECUTION_DENIED',
  TOOL_FAILURE: 'TOOL_FAILURE',
  UNKNOWN: 'UNKNOWN'
});

export const Outcome = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  INTERRUPTED: 'INTERRUPTED',
  UNKNOWN: 'UNKNOWN'
});

/**
 * @typedef {object} CanonicalExecution
 * @property {string} platform - Platform identity (cursor | gemini | codex | claude | shell | cli | generic)
 * @property {string} eventType - Event lifecycle hook type (PostToolUseFailure, AfterTool, PreToolUse, etc.)
 * @property {string} captureOrigin - Capture invocation source (agent_event | shell_hook | rewind_run)
 * @property {string|null} sessionId - Agent session or conversation ID
 * @property {string|null} toolName - Agent tool name (e.g. 'Bash', 'run_shell_command', 'terminal')
 * @property {string} command - Offending executable or primary command
 * @property {string[]} args - Tokenized command arguments
 * @property {string} fullCommand - Full command line string
 * @property {string} cwd - Current working directory
 * @property {string} startTime - ISO timestamp when command began
 * @property {string} endTime - ISO timestamp when command ended
 * @property {number} durationMs - Execution duration in milliseconds
 * @property {number|null} exitCode - Process exit code (null if killed/interrupted/unknown)
 * @property {string|null} signal - Termination signal (e.g. 'SIGTERM', 'SIGINT')
 * @property {string} outcome - Normalized outcome (SUCCESS | FAILURE | INTERRUPTED | UNKNOWN)
 * @property {string} failureKind - Classified failure type
 * @property {boolean|null} executionStarted - Whether process actually started execution
 * @property {boolean} timedOut - Whether execution exceeded timeout
 * @property {boolean} success - Whether process exited cleanly (exitCode === 0)
 * @property {string} stdout - Sanitized standard output text
 * @property {string} stderr - Sanitized standard error text
 * @property {string} stdoutRaw - Raw standard output text
 * @property {string} stderrRaw - Raw standard error text
 * @property {import('../diagnostics/model.js').StructuredDiagnostic} diagnostic - Structured diagnostic
 * @property {object} environment - Sanitized environment metadata
 * @property {object} git - Git repository metadata
 * @property {string} timestamp - ISO timestamp when canonical event was created
 */

/**
 * Creates a validated, immutable CanonicalExecution record with safe defaults.
 *
 * @param {Partial<CanonicalExecution>} fields
 * @returns {CanonicalExecution}
 */
export function createCanonicalExecution(fields = {}) {
  const exitCode = typeof fields.exitCode === 'number' ? fields.exitCode : null;
  const signal = typeof fields.signal === 'string' ? fields.signal : null;
  const timedOut = Boolean(fields.timedOut);
  const isInterrupt = Boolean(fields.isInterrupt || signal === 'SIGINT');

  let outcome = fields.outcome || Outcome.UNKNOWN;
  if (!fields.outcome) {
    if (isInterrupt) outcome = Outcome.INTERRUPTED;
    else if (exitCode === 0) outcome = Outcome.SUCCESS;
    else if (exitCode !== null && exitCode > 0) outcome = Outcome.FAILURE;
  }

  let failureKind = fields.failureKind || FailureKind.UNKNOWN;
  if (!fields.failureKind) {
    if (timedOut) failureKind = FailureKind.TIMEOUT;
    else if (isInterrupt) failureKind = FailureKind.INTERRUPTED;
    else if (exitCode !== null && exitCode > 0) failureKind = FailureKind.EXECUTION_FAILURE;
  }

  const execution = {
    platform: fields.platform || Platform.GENERIC,
    source: fields.platform || Platform.GENERIC,
    eventType: fields.eventType || EventType.COMMAND,
    captureOrigin: fields.captureOrigin || CaptureOrigin.AGENT_EVENT,
    sessionId: fields.sessionId || null,
    toolName: fields.toolName || null,
    command: fields.command || '',
    args: Array.isArray(fields.args) ? fields.args : [],
    fullCommand: fields.fullCommand || fields.command || '',
    cwd: fields.cwd || process.cwd(),
    startTime: fields.startTime || new Date().toISOString(),
    endTime: fields.endTime || new Date().toISOString(),
    durationMs: typeof fields.durationMs === 'number' && fields.durationMs >= 0 ? fields.durationMs : 0,
    exitCode,
    signal,
    outcome,
    failureKind,
    executionStarted: fields.executionStarted !== undefined ? fields.executionStarted : (exitCode !== null || Boolean(fields.stderrRaw || fields.stdoutRaw)),
    timedOut,
    success: exitCode === 0,
    stdout: typeof fields.stdout === 'string' ? fields.stdout : '',
    stderr: typeof fields.stderr === 'string' ? fields.stderr : '',
    stdoutRaw: typeof fields.stdoutRaw === 'string' ? fields.stdoutRaw : '',
    stderrRaw: typeof fields.stderrRaw === 'string' ? fields.stderrRaw : '',
    diagnostic: fields.diagnostic || null,
    environment: fields.environment || {},
    git: fields.git || { isGit: false, branch: null },
    timestamp: fields.timestamp || new Date().toISOString()
  };

  return Object.freeze(execution);
}
