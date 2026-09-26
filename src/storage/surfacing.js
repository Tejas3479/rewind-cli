import { computeFingerprint } from './fingerprint.js';
import { evaluateStaleness } from './staleness.js';
import { extractNegativeMemory } from './negative_memory.js';
import { analyzeEvidenceConflicts } from './contradiction.js';

/**
 * @typedef {object} RecoveryCandidate
 * @property {string} incidentId
 * @property {number} attemptId
 * @property {string|null} cause
 * @property {string|null} change
 * @property {string|null} verifyCmd
 * @property {string} status
 * @property {string} evidenceQuality
 * @property {string} verifiedAt
 * @property {object} staleness
 * @property {boolean} isStale
 * @property {string[]} stalenessReasons
 * @property {boolean} isContradicted
 */

/**
 * @typedef {object} SurfacingDecision
 * @property {'SURFACE' | 'CAUTION' | 'SILENCE'} action
 * @property {string} reason
 * @property {'EXACT' | 'SIMILAR' | 'NONE'} matchType
 * @property {RecoveryCandidate | null} bestCandidate
 * @property {Array<import('./negative_memory.js').FailedApproach>} relevantFailedApproaches
 */

/**
 * Evaluates whether historical evidence should be surfaced for the given failure record.
 * Ranks recovery candidates at the individual recovery level and applies strict abstention
 * policies for stale or contradicted evidence.
 *
 * @param {import('./record.js').IncidentRecord|object} currentRecord
 * @param {import('./store.js').StorageEngine} storage
 * @returns {SurfacingDecision}
 */
export function evaluateSurfacing(currentRecord, storage) {
  if (!currentRecord || !storage) {
    return {
      action: 'SILENCE',
      reason: 'Missing record or storage context',
      matchType: 'NONE',
      bestCandidate: null,
      relevantFailedApproaches: []
    };
  }

  const computed = computeFingerprint({
    command: currentRecord.command || '',
    args: currentRecord.args || [],
    exitCode: currentRecord.exitCode,
    signal: currentRecord.signal,
    stderr: currentRecord.stderr || '',
    stdout: currentRecord.stdout || ''
  });
  const fingerprint = currentRecord.fingerprint || computed.fingerprint;

  if (!fingerprint) {
    return {
      action: 'SILENCE',
      reason: 'Could not compute fingerprint for failure',
      matchType: 'NONE',
      bestCandidate: null,
      relevantFailedApproaches: []
    };
  }

  // Retrieve all historical incidents sharing this fingerprint
  const matchingIncidents = storage.findByFingerprint(fingerprint);
  const historicalRecords = matchingIncidents.filter(
    (r) => String(r.id) !== String(currentRecord.id)
  );

  if (historicalRecords.length === 0) {
    return {
      action: 'SILENCE',
      reason: 'No historical failures matching fingerprint',
      matchType: 'NONE',
      bestCandidate: null,
      relevantFailedApproaches: []
    };
  }

  // Pre-analyze conflict evidence across all historical runs
  const conflictReport = analyzeEvidenceConflicts(fingerprint, historicalRecords);

  // Extract all verified recovery candidates per recovery attempt
  const candidates = [];

  for (const record of historicalRecords) {
    if (!record) continue;

    const staleness = evaluateStaleness(
      record,
      currentRecord.environment,
      currentRecord.git
    );

    if (Array.isArray(record.recoveryAttempts)) {
      for (const attempt of record.recoveryAttempts) {
        const isVerified =
          attempt.status === 'VERIFIED' ||
          (Array.isArray(attempt.verificationRuns) &&
            attempt.verificationRuns.some((run) => run.result === 'PASSED' || run.exitCode === 0));

        if (isVerified) {
          // Check if this specific command has a direct contradiction under equivalent environment
          let isContradicted = false;
          if (conflictReport.hasConflicts && conflictReport.classification === 'CONTRADICTED') {
            const hasConflictForAttempt = conflictReport.conflicts.some((c) => {
              if (c.type !== 'CONTRADICTED') return false;
              const matchesA = String(c.evidenceA.incidentId) === String(record.id) && c.evidenceA.attemptId === attempt.id;
              const matchesB = String(c.evidenceB.incidentId) === String(record.id) && c.evidenceB.attemptId === attempt.id;
              return matchesA || matchesB;
            });
            if (hasConflictForAttempt) {
              isContradicted = true;
            }
          }

          candidates.push({
            incidentId: record.id,
            attemptId: attempt.id,
            cause: attempt.cause || null,
            change: attempt.change || null,
            verifyCmd: attempt.verifyCmd || null,
            status: attempt.status,
            evidenceQuality: attempt.evidenceQuality || 'DIRECT',
            verifiedAt: attempt.createdAt || record.endTime || record.startTime,
            staleness,
            isStale: staleness.isStale,
            stalenessReasons: staleness.reasons || [],
            isContradicted
          });
        }
      }
    } else if (record.status === 'RECOVERED' || record.status === 'VERIFIED') {
      // Legacy recovery structure compatibility
      const lastRec = Array.isArray(record.recoveries) && record.recoveries.length > 0
        ? record.recoveries[record.recoveries.length - 1]
        : null;

      candidates.push({
        incidentId: record.id,
        attemptId: 1,
        cause: lastRec?.cause || null,
        change: lastRec?.change || null,
        verifyCmd: lastRec?.verifyCmd || record.verification?.command || null,
        status: record.status,
        evidenceQuality: 'DIRECT',
        verifiedAt: record.verification?.verifiedAt || record.endTime || record.startTime,
        staleness,
        isStale: staleness.isStale,
        stalenessReasons: staleness.reasons || [],
        isContradicted: conflictReport.classification === 'CONTRADICTED'
      });
    }
  }

  // Sort candidates by quality tier:
  // Tier 1: Compatible & Non-contradicted (best)
  // Tier 2: Compatible & Contradicted
  // Tier 3: Stale & Non-contradicted
  // Tier 4: Stale & Contradicted
  // Within tier: newest verified first
  candidates.sort((a, b) => {
    const scoreA = (a.isStale ? 2 : 0) + (a.isContradicted ? 1 : 0);
    const scoreB = (b.isStale ? 2 : 0) + (b.isContradicted ? 1 : 0);
    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }
    return new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime();
  });

  const bestCandidate = candidates[0] || null;

  // Extract negative memory (known failed approaches)
  const allFailed = extractNegativeMemory(historicalRecords);
  // Filter out any failed approaches that match the best verified fix change
  const relevantFailedApproaches = allFailed
    .filter((fa) => fa.change && fa.change !== bestCandidate?.change)
    .slice(0, 3);

  // Decide action based on candidate trust and evidence quality
  let action = 'SILENCE';
  let reason = '';

  if (bestCandidate) {
    if (!bestCandidate.isStale && !bestCandidate.isContradicted) {
      action = 'SURFACE';
      reason = 'Verified recovery with compatible environment';
    } else if (bestCandidate.isStale) {
      action = 'CAUTION';
      const detail = bestCandidate.stalenessReasons[0] || 'environment drift detected';
      reason = `Historical fix exists but environment changed (${detail})`;
    } else if (bestCandidate.isContradicted) {
      action = 'CAUTION';
      reason = 'Historical fix has conflicting verification outcomes under equivalent conditions';
    } else {
      action = 'CAUTION';
      reason = 'Historical fix available with potential caveats';
    }
  } else if (relevantFailedApproaches.length > 0) {
    action = 'CAUTION';
    reason = `No verified fix available, but ${relevantFailedApproaches.length} failed approach(es) known`;
  } else {
    action = 'SILENCE';
    reason = 'Past failures exist for this fingerprint but no verified fixes or failed attempts recorded';
  }

  return {
    action,
    reason,
    matchType: 'EXACT',
    bestCandidate,
    relevantFailedApproaches
  };
}
