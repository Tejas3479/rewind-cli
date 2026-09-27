import { tokenizeCommandLine } from '../parser.js';
import { evaluateStaleness } from './staleness.js';
import { captureSafeEnvironment } from '../environment.js';
import { readGitMetadata } from '../git.js';

/**
 * Normalizes a command string to a canonical token signature for preflight matching.
 *
 * @param {string} cmd
 * @returns {string}
 */
export function normalizeCommandSignature(cmd) {
  if (!cmd || typeof cmd !== 'string') return '';
  const tokens = tokenizeCommandLine(cmd.trim());
  return tokens.join(' ').toLowerCase();
}

/**
 * Evaluates PreToolUse recall against verified past recoveries in storage.
 *
 * Invariant: Preflight cannot use failure fingerprints because the command has not executed yet.
 * It matches exact canonical command signatures.
 * Invariant: Strictly non-blocking advisory context only. Never emit deny or ask decisions.
 *
 * @param {string} commandLine - The raw command line being attempted
 * @param {string} cwd - Current working directory
 * @param {import('./store.js').StorageEngine} storage - Storage engine instance
 * @param {object} [options={}] - Additional environment / git options
 * @returns {{
 *   action: 'PRE_SURFACE' | 'SILENCE',
 *   incidentId?: string,
 *   candidate?: object,
 *   contextText?: string
 * }}
 */
export function evaluatePreflightRecall(commandLine, cwd, storage, options = {}) {
  if (!commandLine || !storage) {
    return { action: 'SILENCE' };
  }

  const normalizedInput = normalizeCommandSignature(commandLine);
  if (!normalizedInput) {
    return { action: 'SILENCE' };
  }

  const { records } = storage.listRecords();
  if (!Array.isArray(records) || records.length === 0) {
    return { action: 'SILENCE' };
  }

  const currentEnv = options.env || captureSafeEnvironment(process.env);
  const currentGit = options.git || readGitMetadata(cwd || process.cwd());

  const candidates = [];

  for (const record of records) {
    if (!record) continue;

    const recordCmdSig = normalizeCommandSignature(
      record.fullCommand || `${record.command || ''} ${(record.args || []).join(' ')}`
    );

    if (recordCmdSig !== normalizedInput) {
      continue;
    }

    // Check recovery attempts for verified fixes
    if (Array.isArray(record.recoveryAttempts)) {
      for (const attempt of record.recoveryAttempts) {
        let isVerified = attempt.status === 'VERIFIED';
        let latestVerificationTime = 0;

        if (Array.isArray(attempt.verificationRuns)) {
          for (const run of attempt.verificationRuns) {
            if (run.result === 'PASSED' || run.exitCode === 0) {
              isVerified = true;
              const t = new Date(run.completedAt || run.startedAt || 0).getTime();
              if (t >= latestVerificationTime) {
                latestVerificationTime = t;
              }
            }
          }
        }

        if (!isVerified) continue;

        // Invariant: External unverified evidence cannot be trusted for pre-surface
        const isLocallyVerified = !attempt.isExternal || Boolean(attempt.locallyVerified);
        if (!isLocallyVerified) continue;

        // Invariant: Check staleness against current environment
        const staleness = evaluateStaleness(record, currentEnv, currentGit);
        if (staleness.isStale) continue;

        // Invariant: Check contradiction
        if (record.fingerprint) {
          const contradiction = storage.getContradictionReport(record.fingerprint);
          if (contradiction && contradiction.hasConflicts && contradiction.classification === 'CONTRADICTED') {
            continue;
          }
        }

        candidates.push({
          incidentId: record.id,
          attempt,
          verifiedAt: latestVerificationTime > 0
            ? new Date(latestVerificationTime).toISOString()
            : (attempt.createdAt || record.endTime || record.startTime || '')
        });
      }
    }
  }

  if (candidates.length === 0) {
    return { action: 'SILENCE' };
  }

  // Sort by newest verifiedAt
  candidates.sort((a, b) => new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime());
  const best = candidates[0];

  const parts = [
    `[Rewind Preflight Advisory]`,
    `Prior verified recovery found for command: "${commandLine.trim()}"`,
    `Incident #${best.incidentId}:`
  ];
  if (best.attempt.cause) {
    parts.push(`Known Failure Cause: ${best.attempt.cause}`);
  }
  if (best.attempt.change) {
    parts.push(`Verified Fix on Record: ${best.attempt.change}`);
  }
  if (best.attempt.verifyCmd) {
    parts.push(`Verification Command: ${best.attempt.verifyCmd}`);
  }

  return {
    action: 'PRE_SURFACE',
    incidentId: String(best.incidentId),
    candidate: best.attempt,
    contextText: parts.join('\n')
  };
}
