import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { IncidentStatus, RecoveryAttemptStatus, ProvenanceType, EvidenceQuality } from './state.js';
import { normalizeRecordToCurrentSchema } from './record.js';

export const PROJECTION_SCHEMA_VERSION = 1;

/**
 * Pure deterministic single-event reducer that applies a journal event to an incident Map in place.
 *
 * @param {Map<string, import('./record.js').IncidentRecord>} incidents - Active index map
 * @param {object} event - Journal event
 * @returns {import('./record.js').IncidentRecord|null} - The updated or created IncidentRecord, or null
 */
export function applyEventToRecordMap(incidents, event) {
  if (!event || !event.type || !event.incidentId) {
    return null;
  }

  const id = String(event.incidentId);

  switch (event.type) {
    case 'failure.observed': {
      const payload = event.payload || {};
      const newRecord = {
        id,
        fingerprint: payload.fingerprint || '',
        command: payload.command || '',
        args: Array.isArray(payload.args) ? payload.args : [],
        fullCommand: payload.fullCommand || `${payload.command || ''} ${(payload.args || []).join(' ')}`.trim(),
        cwd: payload.cwd || '',
        startTime: payload.startTime || event.timestamp,
        endTime: payload.endTime || event.timestamp,
        durationMs: payload.durationMs || 0,
        exitCode: payload.exitCode ?? 1,
        signal: payload.signal || null,
        status: IncidentStatus.OBSERVED,
        stdout: payload.stdoutSnippet || payload.stdout || '',
        stderr: payload.stderrSnippet || payload.stderr || '',
        normalizedError: payload.normalizedError || '',
        evidenceHash: payload.evidenceHash || '',
        evidenceRef: payload.evidenceRef || '',
        diagnostic: payload.diagnostic || null,
        isTruncated: Boolean(payload.isTruncated),
        git: payload.git || { isGit: false },
        environment: payload.environment || {},
        regressionOf: null,
        recoveryAttempts: [],
        _projection: {
          notice: 'DERIVED AND REBUILDABLE. Authoritative source of truth is .rewind/journal.jsonl',
          projectionSchemaVersion: PROJECTION_SCHEMA_VERSION,
          derivedFromSequence: event.sequence,
          projectedAt: event.timestamp
        }
      };
      incidents.set(id, normalizeRecordToCurrentSchema(newRecord));
      break;
    }

    case 'regression.detected': {
      const payload = event.payload || {};
      const newRecord = {
        id,
        fingerprint: payload.fingerprint || '',
        command: payload.command || '',
        args: Array.isArray(payload.args) ? payload.args : [],
        fullCommand: payload.fullCommand || `${payload.command || ''} ${(payload.args || []).join(' ')}`.trim(),
        cwd: payload.cwd || '',
        startTime: payload.startTime || event.timestamp,
        endTime: payload.endTime || event.timestamp,
        durationMs: payload.durationMs || 0,
        exitCode: payload.exitCode ?? 1,
        signal: payload.signal || null,
        status: IncidentStatus.REGRESSED,
        stdout: payload.stdoutSnippet || payload.stdout || '',
        stderr: payload.stderrSnippet || payload.stderr || '',
        normalizedError: payload.normalizedError || '',
        evidenceHash: payload.evidenceHash || '',
        evidenceRef: payload.evidenceRef || '',
        diagnostic: payload.diagnostic || null,
        isTruncated: Boolean(payload.isTruncated),
        git: payload.git || { isGit: false },
        environment: payload.environment || {},
        regressionOf: payload.regressionOf ? String(payload.regressionOf) : null,
        recoveryAttempts: [],
        _projection: {
          notice: 'DERIVED AND REBUILDABLE. Authoritative source of truth is .rewind/journal.jsonl',
          projectionSchemaVersion: PROJECTION_SCHEMA_VERSION,
          derivedFromSequence: event.sequence,
          projectedAt: event.timestamp
        }
      };
      incidents.set(id, normalizeRecordToCurrentSchema(newRecord));
      break;
    }

    case 'recovery.proposed': {
      const existing = incidents.get(id);
      if (!existing) break;

      const payload = event.payload || {};
      const currentAttempts = Array.isArray(existing.recoveryAttempts) ? [...existing.recoveryAttempts] : [];
      const attemptId = payload.attemptId || (currentAttempts.length + 1);
      const isFixed = Boolean(payload.isFixed || payload.status === RecoveryAttemptStatus.FIXED);
      const status = payload.status || (isFixed ? RecoveryAttemptStatus.FIXED : RecoveryAttemptStatus.PROPOSED);
      const quality = payload.evidenceQuality || (isFixed ? EvidenceQuality.UNVERIFIED : (payload.change ? EvidenceQuality.USER_REPORTED : EvidenceQuality.UNVERIFIED));

      const newAttempt = {
        id: attemptId,
        createdAt: event.timestamp,
        cause: payload.cause || null,
        causeProvenance: payload.cause ? (payload.causeProvenance || ProvenanceType.USER_REPORTED) : null,
        change: payload.change || null,
        changeProvenance: payload.change ? (payload.changeProvenance || ProvenanceType.USER_REPORTED) : null,
        verifyCmd: payload.verifyCmd || null,
        verifyCmdProvenance: payload.verifyCmd ? (payload.verifyCmdProvenance || ProvenanceType.USER_REPORTED) : null,
        observedChanges: payload.observedChanges || null,
        status,
        isExternal: Boolean(payload.isExternal),
        externalVerification: payload.externalVerification || null,
        evidenceQuality: quality,
        verificationRuns: []
      };

      const updated = {
        ...existing,
        status: IncidentStatus.OPEN,
        recoveryAttempts: [...currentAttempts, newAttempt],
        _projection: {
          notice: 'DERIVED AND REBUILDABLE. Authoritative source of truth is .rewind/journal.jsonl',
          projectionSchemaVersion: PROJECTION_SCHEMA_VERSION,
          derivedFromSequence: event.sequence,
          projectedAt: event.timestamp
        }
      };
      incidents.set(id, normalizeRecordToCurrentSchema(updated));
      break;
    }

    case 'recovery.fixed': {
      const existing = incidents.get(id);
      if (!existing) break;

      const payload = event.payload || {};
      const currentAttempts = Array.isArray(existing.recoveryAttempts) ? [...existing.recoveryAttempts] : [];
      const targetAttemptId = payload.attemptId || (currentAttempts.length > 0 ? currentAttempts[currentAttempts.length - 1].id : 1);
      const attemptIndex = currentAttempts.findIndex((a) => a.id === targetAttemptId);

      if (attemptIndex !== -1) {
        const targetAttempt = { ...currentAttempts[attemptIndex] };
        targetAttempt.status = RecoveryAttemptStatus.FIXED;
        targetAttempt.evidenceQuality = EvidenceQuality.UNVERIFIED;
        if (payload.observedChanges) {
          targetAttempt.observedChanges = payload.observedChanges;
        }
        currentAttempts[attemptIndex] = targetAttempt;

        const updated = {
          ...existing,
          recoveryAttempts: currentAttempts,
          _projection: {
            notice: 'DERIVED AND REBUILDABLE. Authoritative source of truth is .rewind/journal.jsonl',
            projectionSchemaVersion: PROJECTION_SCHEMA_VERSION,
            derivedFromSequence: event.sequence,
            projectedAt: event.timestamp
          }
        };
        incidents.set(id, normalizeRecordToCurrentSchema(updated));
      }
      break;
    }

    case 'verification.run': {
      const existing = incidents.get(id);
      if (!existing) break;

      const payload = event.payload || {};
      const currentAttempts = Array.isArray(existing.recoveryAttempts) ? [...existing.recoveryAttempts] : [];
      const targetAttemptId = payload.attemptId || (currentAttempts.length > 0 ? currentAttempts[currentAttempts.length - 1].id : 1);
      const attemptIndex = currentAttempts.findIndex(a => a.id === targetAttemptId);

      if (attemptIndex !== -1) {
        const targetAttempt = { ...currentAttempts[attemptIndex] };
        const currentRuns = Array.isArray(targetAttempt.verificationRuns) ? [...targetAttempt.verificationRuns] : [];
        const runId = payload.runId || (currentRuns.length + 1);
        const isPassed = payload.exitCode === 0;

        const newRun = {
          id: runId,
          startedAt: payload.startedAt || event.timestamp,
          completedAt: event.timestamp,
          command: payload.command || targetAttempt.verifyCmd || '',
          exitCode: payload.exitCode ?? (isPassed ? 0 : 1),
          durationMs: payload.durationMs || 0,
          output: payload.output || '',
          outputHash: payload.outputHash || crypto.createHash('sha256').update(payload.output || '', 'utf8').digest('hex'),
          environmentFingerprint: payload.environmentFingerprint || existing.environment?.fingerprint || '',
          result: isPassed ? 'PASSED' : 'FAILED',
          provenance: payload.provenance || ProvenanceType.DIRECTLY_VERIFIED
        };

        targetAttempt.status = isPassed ? RecoveryAttemptStatus.VERIFIED : RecoveryAttemptStatus.FAILED;
        targetAttempt.evidenceQuality = isPassed ? EvidenceQuality.DIRECT : EvidenceQuality.DIRECT;
        if (isPassed) {
          targetAttempt.isExternal = false;
        }
        targetAttempt.verificationRuns = [...currentRuns, newRun];
        currentAttempts[attemptIndex] = targetAttempt;

        const updatedIncidentStatus = isPassed ? IncidentStatus.RECOVERED : existing.status;

        const updated = {
          ...existing,
          status: updatedIncidentStatus,
          recoveryAttempts: currentAttempts,
          _projection: {
            notice: 'DERIVED AND REBUILDABLE. Authoritative source of truth is .rewind/journal.jsonl',
            projectionSchemaVersion: PROJECTION_SCHEMA_VERSION,
            derivedFromSequence: event.sequence,
            projectedAt: event.timestamp
          }
        };
        incidents.set(id, normalizeRecordToCurrentSchema(updated));
      }
      break;
    }

    case 'incident.resolved': {
      const existing = incidents.get(id);
      if (!existing) break;

      const updated = {
        ...existing,
        status: IncidentStatus.RESOLVED,
        _projection: {
          notice: 'DERIVED AND REBUILDABLE. Authoritative source of truth is .rewind/journal.jsonl',
          projectionSchemaVersion: PROJECTION_SCHEMA_VERSION,
          derivedFromSequence: event.sequence,
          projectedAt: event.timestamp
        }
      };
      incidents.set(id, normalizeRecordToCurrentSchema(updated));
      break;
    }
  }

  return incidents.get(id) || null;
}

/**
 * Pure deterministic reducer that replays journal events in chronological sequence
 * to derive the complete set of active IncidentRecord views.
 *
 * @param {Array<object>} events - Ordered journal events
 * @returns {Map<string, import('./record.js').IncidentRecord>}
 */
export function projectEventsToRecords(events = []) {
  const incidents = new Map();

  for (const event of events) {
    applyEventToRecordMap(incidents, event);
  }

  return incidents;
}

/**
 * Atomically renames a temporary file to destination path with cross-platform
 * resilience against Windows EPERM/EBUSY handle contention.
 *
 * @param {string} sourcePath
 * @param {string} destPath
 */
export function safeAtomicRenameSync(sourcePath, destPath) {
  try {
    fs.renameSync(sourcePath, destPath);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EEXIST' || err.code === 'EBUSY') {
      try {
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        fs.renameSync(sourcePath, destPath);
      } catch {
        fs.copyFileSync(sourcePath, destPath);
        try { fs.unlinkSync(sourcePath); } catch {}
      }
    } else {
      throw err;
    }
  }
}

/**
 * Reconstructs all derived incident files in .rewind/records/ from the projected state.
 *
 * Invariants:
 * 1. .rewind/records/ is strictly derived and rebuildable.
 * 2. Writes atomically using tmp file and fsync before rename.
 * 3. Never mutates or alters journal.jsonl.
 *
 * @param {string} ledgerDir - Path to .rewind
 * @param {Map<string, import('./record.js').IncidentRecord>} projectedRecords
 * @returns {{ writtenCount: number, removedCount: number }}
 */

