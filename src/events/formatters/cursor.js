import { formatAgentAdditionalContext } from './context_text.js';

/**
 * Formats native Cursor hook response envelope.
 * Invariant: Returns {} on SILENCE to avoid polluting agent context with empty structures.
 *
 * @param {import('../../storage/surfacing.js').SurfacingDecision} decision
 * @param {string|number} [incidentId]
 * @returns {object}
 */
export function formatCursorOutput(decision, incidentId = '') {
  if (!decision || decision.action === 'SILENCE') {
    return {};
  }

  const contextText = formatAgentAdditionalContext(decision, incidentId);
  if (!contextText) {
    return {};
  }

  return {
    additional_context: contextText
  };
}
