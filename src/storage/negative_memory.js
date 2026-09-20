import { sanitizeForDisplay } from '../sanitizer.js';

/**
 * @typedef {object} FailedApproach
 * @property {string} incidentId - Origin incident ID
 * @property {number} attemptId - Attempt number
 * @property {string} createdAt - Timestamp when attempted
 * @property {string|null} cause - Suspected cause that was tested
 * @property {string|null} change - Attempted fix that failed
 * @property {string|null} verifyCmd - Verification command that failed
 * @property {number|null} exitCode - Failure exit code
 * @property {string|null} outputSnippet - Error output from failed verification
 */

/**
 * Extracts and deduplicates all failed remediation attempts across a collection of failure records.
 *
 * @param {Array<import('./record.js').IncidentRecord>} records
 * @returns {FailedApproach[]}
 */
export function extractNegativeMemory(records = []) {
  const failedApproaches = [];
  const seenSignatures = new Set();

  for (const record of records) {
    if (!record) continue;

    if (Array.isArray(record.recoveryAttempts)) {
      for (const attempt of record.recoveryAttempts) {
        let hasFailedRun = false;
        let lastExitCode = null;
        let lastOutput = null;

        if (Array.isArray(attempt.verificationRuns)) {
          for (const run of attempt.verificationRuns) {
            if (run.result === 'FAILED' || (typeof run.exitCode === 'number' && run.exitCode !== 0)) {
              hasFailedRun = true;
              lastExitCode = run.exitCode;
              lastOutput = run.output;
            }
          }
        }

        if (attempt.status === 'FAILED' || hasFailedRun) {
          const sig = `${attempt.cause || ''}|${attempt.change || ''}|${attempt.verifyCmd || ''}`;
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            failedApproaches.push({
              incidentId: record.id,
              attemptId: attempt.id,
              createdAt: attempt.createdAt || record.startTime,
              cause: attempt.cause || null,
              change: attempt.change || null,
              verifyCmd: attempt.verifyCmd || null,
              exitCode: lastExitCode,
              outputSnippet: lastOutput ? lastOutput.slice(0, 300) : null
            });
          }
        }
      }
    } else if (Array.isArray(record.recoveries) && record.verification && (record.verification.exitCode !== 0 || record.verification.passed === false)) {
      const last = record.recoveries[record.recoveries.length - 1];
      if (last) {
        failedApproaches.push({
          incidentId: record.id,
          attemptId: 1,
          createdAt: last.timestamp || record.startTime,
          cause: last.cause || null,
          change: last.change || null,
          verifyCmd: last.verifyCmd || record.verification.command || null,
          exitCode: record.verification.exitCode || null,
          outputSnippet: record.verification.output ? record.verification.output.slice(0, 300) : null
        });
      }
    }
  }

  // Sort newest first
  return failedApproaches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Renders a visual "KNOWN FAILED APPROACHES" section for CLI display.
 *
 * @param {FailedApproach[]} failedApproaches
 * @param {import('../formatter.js').createStyler} styler
 * @returns {string}
 */
export function formatNegativeMemorySection(failedApproaches, styler) {
  if (!failedApproaches || failedApproaches.length === 0) {
    return '';
  }

  const s = styler;
  const lines = [];

  lines.push(s.bold(s.yellow(`KNOWN FAILED APPROACHES (${failedApproaches.length} prior attempt(s) failed):`)));
  lines.push(s.dim('  The following remediation approaches were explicitly tested and failed verification.'));
  lines.push('');

  for (let i = 0; i < failedApproaches.length; i++) {
    const item = failedApproaches[i];
    const header = `${s.red('✗')} ${s.bold(`Failed Approach #${i + 1}`)} ${s.dim(`[Incident #${item.incidentId}, Attempt #${item.attemptId}]`)}`;
    lines.push(`  ${header}`);

    if (item.change) {
      lines.push(`    ${s.dim('[USER CLAIM] Fix:'.padEnd(26))} ${sanitizeForDisplay(item.change)}`);
    }
    if (item.cause) {
      lines.push(`    ${s.dim('[USER CLAIM] Hypothesis:'.padEnd(26))} ${sanitizeForDisplay(item.cause)}`);
    }
    if (item.verifyCmd) {
      lines.push(`    ${s.dim('Verify Command:'.padEnd(26))} ${s.cyan(sanitizeForDisplay(item.verifyCmd))}`);
    }
    if (item.exitCode !== null && item.exitCode !== undefined) {
      lines.push(`    ${s.dim('[VERIFIED RESULT] Outcome:'.padEnd(26))} ${s.red(`Failed (Exit Code: ${item.exitCode})`)}`);
    }
    if (item.outputSnippet) {
      const cleanSnip = sanitizeForDisplay(item.outputSnippet.split('\n')[0]);
      lines.push(`    ${s.dim('Error Snippet:'.padEnd(26))} ${s.dim(cleanSnip)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
