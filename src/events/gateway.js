import { Platform, EventType, CaptureOrigin } from './model.js';
import { normalizeCursorPayload } from './normalizers/cursor.js';
import { normalizeGeminiPayload } from './normalizers/gemini.js';
import { normalizeCodexPayload } from './normalizers/codex.js';
import { normalizeClaudePayload } from './normalizers/claude.js';
import { normalizeGenericPayload } from './normalizers/generic.js';
import { formatAgentAdditionalContext } from './formatters/context_text.js';
import { formatCursorOutput } from './formatters/cursor.js';
import { formatGeminiOutput } from './formatters/gemini.js';
import { formatCodexOutput } from './formatters/codex.js';
import { formatClaudeOutput, formatClaudePreflightOutput } from './formatters/claude.js';
import { formatGenericOutput } from './formatters/generic.js';
import { CaptureService } from '../storage/service.js';
import { evaluatePreflightRecall } from '../storage/preflight.js';

export { formatAgentAdditionalContext };

/**
 * Normalizes vendor-specific agent hook payloads into a standard CanonicalExecution event.
 * Dispatches explicitly on source if provided; otherwise uses conservative compound auto-detection.
 * Invariant: `tool_input` alone will never infer Cursor.
 *
 * @param {object|string} rawPayload
 * @param {object} [contextOptions={}]
 * @returns {import('./model.js').CanonicalExecution}
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

  const explicitSource = contextOptions.source || data.platform || data.source;

  if (explicitSource === Platform.CURSOR || explicitSource === 'cursor') {
    return normalizeCursorPayload(data, contextOptions);
  }
  if (explicitSource === Platform.GEMINI || explicitSource === 'gemini') {
    return normalizeGeminiPayload(data, contextOptions);
  }
  if (explicitSource === Platform.CODEX || explicitSource === 'codex') {
    return normalizeCodexPayload(data, contextOptions);
  }
  if (explicitSource === Platform.CLAUDE || explicitSource === 'claude') {
    return normalizeClaudePayload(data, contextOptions);
  }
  if (explicitSource === Platform.GENERIC || explicitSource === 'generic') {
    return normalizeGenericPayload(data, contextOptions);
  }

  // Fallback to conservative compound auto-detection
  return normalizeGenericPayload(data, contextOptions);
}

/**
 * Processes an incoming agent event through the complete Gateway pipeline:
 * 1. Normalize vendor payload (explicit or conservative compound)
 * 2. Ingest execution or evaluate preflight recall
 * 3. Return platform-compatible response JSON
 *
 * @param {object|string} rawPayload
 * @param {import('../storage/store.js').StorageEngine} storage
 * @param {object} [options={}]
 * @returns {object} Machine-readable gateway result
 */
export function processAgentEvent(rawPayload, storage, options = {}) {
  const start = Date.now();
  let data = rawPayload;
  if (typeof rawPayload === 'string') {
    try {
      data = JSON.parse(rawPayload);
    } catch {
      data = { rawText: rawPayload };
    }
  }
  data = data && typeof data === 'object' ? data : {};

  const explicitSource = options.source || data.platform || data.source || null;
  const isPreflight = options.eventType === EventType.PRE_TOOL_USE ||
    options.event === EventType.PRE_TOOL_USE ||
    data.hookEventName === 'PreToolUse' ||
    data.eventType === 'PreToolUse';

  // Branch 1: Preflight recall (e.g. Claude Code PreToolUse advisory)
  if (isPreflight) {
    const event = normalizeEvent(data, { ...options, eventType: EventType.PRE_TOOL_USE });
    const preflight = evaluatePreflightRecall(
      event.fullCommand || event.command,
      event.cwd,
      storage,
      options
    );

    if (explicitSource === Platform.CLAUDE || explicitSource === 'claude') {
      return formatClaudePreflightOutput(preflight);
    }

    return {
      action: preflight.action,
      classification: preflight.action === 'PRE_SURFACE' ? 'PROMOTE' : 'DISCARD',
      incidentId: preflight.incidentId || null,
      matchType: preflight.action === 'PRE_SURFACE' ? 'EXACT' : 'NONE',
      durationMs: Date.now() - start,
      additionalContext: preflight.contextText || null,
      additional_context: preflight.contextText || null,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: preflight.contextText || null
      }
    };
  }

  // Branch 2: Tool execution failure ingestion
  const event = normalizeEvent(data, options);
  const ingestion = CaptureService.ingestExecution(event, storage, {
    captureOrigin: CaptureOrigin.AGENT_EVENT
  });

  const durationMs = Date.now() - start;
  const eventName = event.platform === Platform.CODEX ? 'PostToolUse'
    : (event.platform === Platform.CLAUDE ? 'PostToolUseFailure' : 'AfterTool');

  // If source was explicitly specified, format using the platform's native JSON envelope
  if (explicitSource === Platform.CLAUDE || explicitSource === 'claude') {
    return formatClaudeOutput(ingestion.decision, ingestion.incidentId);
  }
  if (explicitSource === Platform.CURSOR || explicitSource === 'cursor') {
    return formatCursorOutput(ingestion.decision, ingestion.incidentId);
  }
  if (explicitSource === Platform.GEMINI || explicitSource === 'gemini') {
    return formatGeminiOutput(ingestion.decision, ingestion.incidentId);
  }
  if (explicitSource === Platform.CODEX || explicitSource === 'codex') {
    return formatCodexOutput(ingestion.decision, ingestion.incidentId);
  }

  // Generic / Default: return unified response object
  return formatGenericOutput(ingestion.decision, ingestion.incidentId, {
    classification: ingestion.classification,
    observationId: ingestion.observationId,
    durationMs,
    eventName
  });
}
