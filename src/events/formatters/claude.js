import { formatAgentAdditionalContext } from './context_text.js';

/**
 * Formats native Claude Code PostToolUseFailure response envelope.
 * Invariant: Returns {} on SILENCE.
 *
 * @param {import('../../storage/surfacing.js').SurfacingDecision} decision
 * @param {string|number} [incidentId]
 * @returns {object}
 */
export function formatClaudeOutput(decision, incidentId = '') {
  if (!decision || decision.action === 'SILENCE') {
    return {};
  }

  const contextText = formatAgentAdditionalContext(decision, incidentId);
  if (!contextText) {
    return {};
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: contextText
    }
  };
}

/**
 * Formats native Claude Code PreToolUse advisory response envelope.
 * Invariant: Advisory only — strictly never emits permissionDecision: deny or ask.
 * Returns {} on silence.
 *
 * @param {object} preflightResult
 * @param {string} [preflightResult.action] - 'PRE_SURFACE' | 'SILENCE'
 * @param {string} [preflightResult.contextText] - Advisory context
 * @returns {object}
 */
export function formatClaudePreflightOutput(preflightResult = {}) {
  if (!preflightResult || preflightResult.action !== 'PRE_SURFACE' || !preflightResult.contextText) {
    return {};
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: preflightResult.contextText
    }
  };
}
