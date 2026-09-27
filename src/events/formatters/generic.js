import { formatAgentAdditionalContext } from './context_text.js';

/**
 * Formats generic / programmatic JSON response for event processing.
 *
 * @param {import('../../storage/surfacing.js').SurfacingDecision} decision
 * @param {string|number} [incidentId]
 * @param {object} [metadata={}]
 * @returns {object}
 */
export function formatGenericOutput(decision, incidentId = '', metadata = {}) {
  const contextText = formatAgentAdditionalContext(decision, incidentId);

  return {
    action: decision?.action || 'SILENCE',
    classification: metadata.classification || 'DISCARD',
    incidentId: incidentId || null,
    observationId: metadata.observationId || null,
    matchType: decision?.matchType || 'NONE',
    reason: decision?.reason || '',
    durationMs: metadata.durationMs || 0,
    bestCandidate: decision?.bestCandidate || null,
    relevantFailedApproaches: decision?.relevantFailedApproaches || [],
    additionalContext: contextText || null,
    additional_context: contextText || null,
    hookSpecificOutput: {
      hookEventName: metadata.eventName || 'AfterTool',
      additionalContext: contextText || null
    }
  };
}
