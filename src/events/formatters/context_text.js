/**
 * Formats structured additionalContext text for agent context injection.
 * Shared across Cursor, Gemini, Codex, and Claude platform formatters.
 *
 * @param {import('../../storage/surfacing.js').SurfacingDecision} decision
 * @param {string|number} [incidentId]
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
        parts.push(`- Avoid: "${fa.change || fa.cause || 'Unknown'}" (Failed)`);
      }
    }

    if (fix.verifyCmd) {
      parts.push(`\nImportant: Verification commands require host/user execution approval.`);
    }
  } else if (decision.action === 'CAUTION') {
    parts.push(`[Rewind Caution]`);
    parts.push(`Prior failure detected: ${decision.reason}`);
    if (decision.bestCandidate) {
      const fix = decision.bestCandidate;
      parts.push(`Historical Fix: ${fix.change || fix.cause}`);
      if (fix.stalenessReasons && fix.stalenessReasons.length > 0) {
        parts.push(`Caveat: ${fix.stalenessReasons.join('; ')}`);
      }
    }
    if (decision.relevantFailedApproaches && decision.relevantFailedApproaches.length > 0) {
      parts.push(`Known failed attempts:`);
      for (const fa of decision.relevantFailedApproaches) {
        parts.push(`• Failed: ${fa.change || fa.cause}`);
      }
    }
    if (incidentId) {
      parts.push(`Run "rewind show ${incidentId}" for complete forensic evidence.`);
    }
  }

  return parts.join('\n');
}
