import { readCheckpoint } from '../storage/journal.js';
import { formatBox, formatJson } from '../formatter.js';

export async function statsCommand({ context }) {
  const { storage, stdout, styler, parsedArgs } = context;

  const { records, total } = storage.listRecords();
  const checkpoint = readCheckpoint(storage.ledgerDir);
  const eventCount = checkpoint?.eventCount || 0;

  let totalIncidents = total;
  let totalRecoveryAttempts = 0;
  let verifiedFixes = 0;
  let failedApproaches = 0;

  const statusCounts = {
    OBSERVED: 0,
    OPEN: 0,
    RECOVERED: 0,
    REGRESSED: 0,
    RESOLVED: 0,
  };

  const fingerprintCounts = {};
  let totalRecoveryTimeMs = 0;
  let recoveryTimeCount = 0;

  for (const record of records) {
    if (statusCounts[record.status] !== undefined) {
      statusCounts[record.status]++;
    } else {
      statusCounts[record.status] = 1;
    }

    if (record.fingerprint) {
      fingerprintCounts[record.fingerprint] = (fingerprintCounts[record.fingerprint] || 0) + 1;
    }

    if (record.status === 'VERIFIED' || record.status === 'RECOVERED') {
      verifiedFixes++;
    }

    if (record.recoveryAttempts && record.recoveryAttempts.length > 0) {
      totalRecoveryAttempts += record.recoveryAttempts.length;

      const observedTime = new Date(record.timestamp).getTime();
      const firstAttempt = record.recoveryAttempts[0];
      const attemptTime = new Date(firstAttempt.timestamp).getTime();
      if (!Number.isNaN(observedTime) && !Number.isNaN(attemptTime)) {
        totalRecoveryTimeMs += (attemptTime - observedTime);
        recoveryTimeCount++;
      }

      for (const attempt of record.recoveryAttempts) {
        if (attempt.verificationRuns) {
          for (const run of attempt.verificationRuns) {
            if (run.exitCode !== 0) {
              failedApproaches++;
            }
          }
        }
      }
    }
  }

  let mostCommonFingerprint = 'None';
  let maxFingerprintCount = 0;
  for (const [fp, count] of Object.entries(fingerprintCounts)) {
    if (count > maxFingerprintCount) {
      maxFingerprintCount = count;
      mostCommonFingerprint = fp;
    }
  }

  const avgRecoveryTimeMs = recoveryTimeCount > 0 ? totalRecoveryTimeMs / recoveryTimeCount : 0;
  const avgRecoveryTimeStr = avgRecoveryTimeMs > 0 ? `${Math.round(avgRecoveryTimeMs / 1000)}s` : 'N/A';

  const stats = {
    totalIncidents,
    statusBreakdown: statusCounts,
    totalRecoveryAttempts,
    verifiedFixes,
    failedApproaches,
    mostCommonErrorFingerprint: mostCommonFingerprint,
    averageTimeToFirstRecoveryAttempt: avgRecoveryTimeStr,
    journalEventCount: eventCount
  };

  if (parsedArgs.flags.json) {
    stdout.write(formatJson(stats) + '\n');
    return 0;
  }

  const fields = [
    { label: 'Total Incidents', value: String(totalIncidents) },
    { label: 'Verified Fixes', value: String(verifiedFixes) },
    { label: 'Failed Approaches', value: String(failedApproaches) },
    { label: 'Recovery Attempts', value: String(totalRecoveryAttempts) },
    { label: 'Avg Time to 1st Fix', value: avgRecoveryTimeStr },
    { label: 'Common Fingerprint', value: mostCommonFingerprint },
    { label: 'Journal Events', value: String(eventCount) },
    { label: 'Status: OBSERVED', value: String(statusCounts.OBSERVED) },
    { label: 'Status: OPEN', value: String(statusCounts.OPEN) },
    { label: 'Status: RECOVERED', value: String(statusCounts.RECOVERED) },
    { label: 'Status: REGRESSED', value: String(statusCounts.REGRESSED) },
    { label: 'Status: RESOLVED', value: String(statusCounts.RESOLVED) }
  ];

  stdout.write(formatBox('Rewind Stats', fields, styler, 'info') + '\n');
  return 0;
}
