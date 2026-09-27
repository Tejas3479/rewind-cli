import { formatAgentAdditionalContext } from './context_text.js';

/**
 * Formats native Gemini CLI AfterTool response envelope.
 * Invariant: Returns {} on SILENCE.
 *
 * @param {import('../../storage/surfacing.js').SurfacingDecision} decision
 * @param {string|number} [incidentId]
 * @returns {object}
 */
export function formatGeminiOutput(decision, incidentId = '') {
  if (!decision || decision.action === 'SILENCE') {
    return {};
  }

  const contextText = formatAgentAdditionalContext(decision, incidentId);
  if (!contextText) {
    return {};
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'AfterTool',
      additionalContext: contextText
    }
  };
}
