import { formatAgentAdditionalContext } from './context_text.js';

/**
 * Formats native Codex CLI PostToolUse response envelope.
 * Invariant: Returns {} on SILENCE.
 *
 * @param {import('../../storage/surfacing.js').SurfacingDecision} decision
 * @param {string|number} [incidentId]
 * @returns {object}
 */
export function formatCodexOutput(decision, incidentId = '') {
  if (!decision || decision.action === 'SILENCE') {
    return {};
  }

  const contextText = formatAgentAdditionalContext(decision, incidentId);
  if (!contextText) {
    return {};
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: contextText
    }
  };
}
