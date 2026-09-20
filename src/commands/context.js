import { formatJson, formatRelativeTime } from '../formatter.js';
import { sanitizeForDisplay } from '../sanitizer.js';

/**
 * Handler for `rewind context [latest|<id>] [options]`.
 * Produces structured diagnostic context for coding agents and human inspection.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function contextCommand({ context }) {
  const { parsedArgs, storage, stdout, styler } = context;
  const s = styler;

  const target = parsedArgs.positional[0] || 'latest';
  const limit = typeof parsedArgs.flags.limit === 'number' && parsedArgs.flags.limit > 0 ? parsedArgs.flags.limit : undefined;
  const agentContext = storage.getAgentContext(target, { maxMatches: limit });

  if (parsedArgs.flags.json) {
    stdout.write(formatJson(agentContext) + '\n');
    return 0;
  }

  if (agentContext.status === 'empty') {
    stdout.write('Ledger is empty. No failure context available.\n');
    return 0;
  }

  const { observedEvidence, derivedAnalysis, ledgerTrust, suggestedActions } = agentContext;
  const failure = observedEvidence.failure;

  stdout.write('\n' + s.bold('REWIND AGENT CONTEXT') + ` (Incident #${failure.id} [${failure.fingerprint}])\n`);
  stdout.write(s.dim('────────────────────────────────────────────────────────────────────────\n'));

  // Ledger Trust Header
  const trustBadge = ledgerTrust.isTrusted
    ? s.green(s.bold('[LEDGER TRUSTED]'))
    : s.red(s.bold('[LEDGER UNTRUSTED — INTEGRITY VIOLATION]'));
  stdout.write(`  ${s.dim('Ledger Trust:')}    ${trustBadge}\n`);

  stdout.write(`  ${s.dim('Failed Command:')}  ${s.bold(failure.fullCommand)}\n`);
  stdout.write(`  ${s.dim('Exit Code:')}      ${s.red(String(failure.exitCode))}`);
  if (failure.createdAt) {
    stdout.write(` (${formatRelativeTime(failure.createdAt)})\n`);
  } else {
    stdout.write('\n');
  }

  stdout.write(`  ${s.dim('Error Snippet:')}   ${sanitizeForDisplay(failure.normalizedError || failure.stderrSnippet.split('\n')[0])}\n`);

  // Historical Matches
  const exactCount = observedEvidence.historicalMatches.exactCount;
  const similarCount = observedEvidence.historicalMatches.similarCount;
  stdout.write(`  ${s.dim('History Matches:')} ${s.bold(String(exactCount))} exact, ${similarCount} similar\n`);

  // Verified Remedies
  const verifiedList = observedEvidence.remedies.verified;
  stdout.write('\n  ' + s.bold('HISTORICAL REMEDIES') + ':\n');
  if (verifiedList.length === 0) {
    stdout.write(`    ${s.dim('• No verified remediation recorded for this failure family.')}\n`);
  } else {
    for (const v of verifiedList) {
      const statusBadge = v.status === 'VERIFIED'
        ? s.green(s.bold('[VERIFIED RECOVERY]'))
        : s.yellow(s.bold(`[${v.status}]`));
      stdout.write(`    • ${statusBadge} Incident #${v.provenance.sourceIncidentId}\n`);
      stdout.write(`      ${s.dim('Suspected Cause:')} ${sanitizeForDisplay(v.cause)}\n`);
      stdout.write(`      ${s.dim('Remediation:')}     ${sanitizeForDisplay(v.change)}\n`);
      stdout.write(`      ${s.dim('Verify Command:')}  ${v.verificationCommand.command}\n`);
      if (v.currentApplicability.isStale) {
        stdout.write(`      ${s.yellow('⚠ Potentially Stale:')} ${v.currentApplicability.reasons.join(', ')}\n`);
      }
    }
  }

  // Failed Approaches (Negative Memory)
  const failedList = observedEvidence.remedies.failedApproaches;
  if (failedList.length > 0) {
    stdout.write('\n  ' + s.bold('KNOWN FAILED APPROACHES (Negative Memory)') + ':\n');
    for (const f of failedList) {
      stdout.write(`    • ${s.red('[FAILED ATTEMPT]')} ${sanitizeForDisplay(f.change || f.cause)}\n`);
    }
  }

  // Delta & Applicability Analysis
  if (derivedAnalysis.unprovenAssumptions.length > 0) {
    stdout.write('\n  ' + s.bold('EVIDENTIARY ASSUMPTIONS & DELTAS') + ':\n');
    for (const a of derivedAnalysis.unprovenAssumptions) {
      stdout.write(`    • ${s.dim(a)}\n`);
    }
  }

  // Suggested Actions & Safety
  stdout.write('\n  ' + s.bold('SUGGESTED NEXT ACTIONS') + ':\n');
  for (const act of suggestedActions) {
    stdout.write(`    • ${s.cyan(act)}\n`);
  }

  stdout.write(s.dim('\n────────────────────────────────────────────────────────────────────────\n'));
  stdout.write(s.dim('Safety: Historical recovery is empirical evidence, not authority. Never automatically replay commands without review.\n\n'));

  return 0;
}
