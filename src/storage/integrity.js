import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalStringify, computeCanonicalDigest } from './canonical.js';
import { GENESIS_HASH, readJournalEvents, readCheckpoint } from './journal.js';
import { projectEventsToRecords } from './projection.js';
import { normalizeRecordToCurrentSchema } from './record.js';

/**
 * Strips projection metadata prior to semantic comparison
 * so that replayed records and on-disk records can be compared canonically.
 *
 * @param {object} record
 * @returns {object}
 */
function cleanRecordForComparison(record) {
  if (!record || typeof record !== 'object') return record;
  const copy = { ...record };
  delete copy._projection;
  return copy;
}

/**
 * Performs a comprehensive, four-layer read-only integrity audit of the local Rewind ledger
 * using pre-parsed journal events.
 *
 * This variant accepts pre-parsed events to avoid redundant disk reads when the caller
 * (e.g. buildAgentContext) has already read the journal.
 *
 * Invariants:
 * 1. Strictly read-only: never modifies, deletes, re-seals, or repairs files on disk.
 * 2. Layer 1: Cryptographic Event Integrity (canonical SHA-256 payload verification).
 * 3. Layer 2: Cryptographic Chain Continuity (sequence monotonicity, UUID uniqueness, genesis, prevHash -> chainHash).
 * 4. Layer 3: Cryptographic Checkpoint Anchor (detects tail deletions, full-chain rewrites, and crash lag).
 * 5. Layer 4: Logical Projection Consistency (verifies derived .rewind/records/*.json matches pure journal replay).
 * 6. Quarantine Audit: Isolated malformed files reported separately without polluting active chain logic.
 *
 * @param {object} params
 * @param {Array<object>} params.events - Pre-parsed journal events
 * @param {Array<object>} [params.malformed=[]] - Malformed journal lines
 * @param {number} [params.totalLines=0] - Total lines parsed from journal
 * @param {string} params.ledgerDir - Absolute path to .rewind
 * @param {Map<string, object>} [params.projectedRecords] - Pre-computed projected records (avoids redundant replay)
 * @returns {object} - Complete forensic audit report
 */
export function verifyLedgerIntegrityFromEvents({ events, malformed = [], totalLines = 0, ledgerDir, projectedRecords }) {
  const quarantineDir = path.join(ledgerDir, 'quarantine');

  const errors = [];
  let firstInvalidEvent = null;

  function recordError(type, message, context = {}) {
    const errorObj = { type, message, ...context };
    errors.push(errorObj);
    if (!firstInvalidEvent && (context.sequence !== undefined || context.lineNumber !== undefined)) {
      firstInvalidEvent = errorObj;
    }
  }

  for (const mal of malformed) {
    recordError('MALFORMED_RECORD', `Unparseable JSON at journal line ${mal.lineNumber}: ${mal.error}`, {
      lineNumber: mal.lineNumber,
      raw: mal.raw
    });
  }

  let validEventsCount = 0;
  let chainIntact = true;
  const seenEventIds = new Set();

  // ─────────────────────────────────────────────────────────────
  // 2. Layer 1 & Layer 2: Event Integrity & Chain Continuity
  // ─────────────────────────────────────────────────────────────
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const expectedSeq = i + 1;
    let eventValid = true;

    // Check required fields
    if (!event || typeof event !== 'object') {
      recordError('SCHEMA_VIOLATION', `Event at position ${i} is not a valid object`, { index: i });
      chainIntact = false;
      continue;
    }

    const {
      journalFormatVersion,
      eventSchemaVersion,
      sequence,
      eventId,
      timestamp,
      type,
      incidentId,
      payload,
      prevHash,
      eventHash,
      chainHash
    } = event;

    if (!sequence || !eventId || !type || !incidentId || !prevHash || !eventHash || !chainHash) {
      recordError('SCHEMA_VIOLATION', `Event at sequence #${sequence || expectedSeq} is missing mandatory cryptographic fields`, {
        sequence: sequence || expectedSeq,
        incidentId: incidentId || 'unknown'
      });
      eventValid = false;
    }

    // Sequence continuity check
    if (sequence !== expectedSeq) {
      recordError('SEQUENCE_GAP', `Sequence discontinuity: expected #${expectedSeq}, got #${sequence}`, {
        sequence,
        expected: String(expectedSeq),
        actual: String(sequence)
      });
      eventValid = false;
    }

    // Event ID uniqueness check
    if (eventId) {
      if (seenEventIds.has(eventId)) {
        recordError('DUPLICATE_EVENT_ID', `Duplicate eventId "${eventId}" at sequence #${sequence}`, {
          sequence,
          eventId
        });
        eventValid = false;
      } else {
        seenEventIds.add(eventId);
      }
    }

    // Layer 1: Canonical Event Hash Recomputation
    if (eventValid) {
      try {
        const expectedEventHash = computeCanonicalDigest({
          journalFormatVersion: journalFormatVersion || 1,
          eventSchemaVersion: eventSchemaVersion || 1,
          sequence,
          eventId,
          timestamp,
          type,
          incidentId: String(incidentId),
          payload
        });

        if (eventHash !== expectedEventHash) {
          recordError('EVENT_HASH_MISMATCH', `Event #${sequence} content was modified on disk (computed eventHash does not match)`, {
            sequence,
            incidentId: String(incidentId),
            expected: expectedEventHash,
            actual: eventHash
          });
          eventValid = false;
        }
      } catch (canonErr) {
        recordError('CANONICALIZATION_FAILURE', `Event #${sequence} cannot be canonicalized: ${canonErr.message}`, {
          sequence,
          incidentId: String(incidentId)
        });
        eventValid = false;
      }
    }

    // Layer 2: Predecessor and Chain Hash Continuity
    const expectedPrevHash = (i === 0) ? GENESIS_HASH : events[i - 1].chainHash;
    if (prevHash !== expectedPrevHash) {
      recordError('CHAIN_BREAK', `Predecessor link broken at Event #${sequence}: prevHash does not match predecessor chainHash`, {
        sequence,
        expected: expectedPrevHash,
        actual: prevHash
      });
      eventValid = false;
    }

    if (eventValid) {
      const expectedChainHash = crypto.createHash('sha256').update(`${prevHash}:${eventHash}`, 'utf8').digest('hex');
      if (chainHash !== expectedChainHash) {
        recordError('CHAIN_HASH_MISMATCH', `Chain hash invalid at Event #${sequence}`, {
          sequence,
          expected: expectedChainHash,
          actual: chainHash
        });
        eventValid = false;
      }
    }

    if (eventValid) {
      validEventsCount++;
    } else {
      chainIntact = false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Layer 3: Trusted Checkpoint Anchor Audit
  // ─────────────────────────────────────────────────────────────
  const checkpoint = readCheckpoint(ledgerDir);
  let checkpointMatches = true;
  let checkpointLagging = false;

  if (events.length === 0) {
    if (checkpoint && checkpoint.headSequence > 0) {
      recordError('CHECKPOINT_MISMATCH', 'Checkpoint references non-empty ledger but journal is empty (possible total journal deletion)', {
        expected: String(checkpoint.headSequence),
        actual: '0'
      });
      checkpointMatches = false;
    }
  } else {
    const lastEvent = events[events.length - 1];

    if (!checkpoint) {
      // Checkpoint file missing
      checkpointMatches = false;
      recordError('CHECKPOINT_MISSING', 'Trusted checkpoint anchor (.rewind/checkpoint.json) is missing');
    } else if (events.length < checkpoint.headSequence) {
      // Tail events were deleted!
      checkpointMatches = false;
      recordError('CHECKPOINT_MISMATCH', `Tail deletion detected: checkpoint references sequence #${checkpoint.headSequence}, but journal only has #${events.length}`, {
        expected: String(checkpoint.headSequence),
        actual: String(events.length)
      });
    } else if (events.length === checkpoint.headSequence) {
      // Exact sequence count: verify head hash
      if (lastEvent.chainHash !== checkpoint.headChainHash) {
        checkpointMatches = false;
        recordError('CHECKPOINT_MISMATCH', 'Journal head hash does not match trusted checkpoint anchor (possible journal rewrite attack)', {
          expected: checkpoint.headChainHash,
          actual: lastEvent.chainHash
        });
      }
    } else if (events.length > checkpoint.headSequence) {
      // Journal has more events than checkpoint (crash lag scenario)
      const checkpointHeadEvent = events[checkpoint.headSequence - 1];
      if (checkpointHeadEvent && checkpointHeadEvent.chainHash === checkpoint.headChainHash) {
        // Legitimate crash lag: extra events strictly extend the verified checkpoint
        checkpointLagging = true;
      } else {
        checkpointMatches = false;
        recordError('CHECKPOINT_MISMATCH', 'Journal diverged from checkpoint anchor at sequence #' + checkpoint.headSequence, {
          expected: checkpoint.headChainHash,
          actual: checkpointHeadEvent ? checkpointHeadEvent.chainHash : 'missing'
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Layer 4: Logical Projection Consistency Audit
  // ─────────────────────────────────────────────────────────────
  let projectionConsistentCount = 0;
  let projectionDriftCount = 0;

  if (chainIntact && malformed.length === 0) {
    const projectedMap = projectedRecords || projectEventsToRecords(events);
    
    // Validate against SQLite Database
    const dbPath = path.join(ledgerDir, 'projection.db');
    let db = null;
    let onDiskIds = new Set();
    
    if (fs.existsSync(dbPath)) {
      try {
        db = new DatabaseSync(dbPath);
        const rows = db.prepare('SELECT id, data FROM records').all();
        
        for (const row of rows) {
          onDiskIds.add(row.id);
          const projectedRecord = projectedMap.get(row.id);
          
          if (!projectedRecord) {
            recordError('ORPHAN_PROJECTION', `Extraneous record "${row.id}" found in SQLite without matching journal events`, {
              incidentId: row.id
            });
            projectionDriftCount++;
            continue;
          }
          
          try {
            const diskParsed = JSON.parse(row.data);
            const diskClean = cleanRecordForComparison(normalizeRecordToCurrentSchema(diskParsed));
            const projClean = cleanRecordForComparison(projectedRecord);

            const diskCanon = canonicalStringify(diskClean);
            const projCanon = canonicalStringify(projClean);

            if (diskCanon !== projCanon) {
              recordError('PROJECTION_DRIFT', `Derived record #${row.id} does not match canonical replay of authoritative journal`, {
                incidentId: row.id
              });
              projectionDriftCount++;
            } else {
              projectionConsistentCount++;
            }
          } catch (err) {
            recordError('PROJECTION_DRIFT', `Derived record #${row.id} is corrupt or unreadable: ${err.message}`, {
              incidentId: row.id
            });
            projectionDriftCount++;
          }
        }
      } catch (err) {
        recordError('PROJECTION_DRIFT', `Could not query SQLite projection database: ${err.message}`);
      } finally {
        if (db) {
          try { db.close(); } catch {}
        }
      }
    }
    
    for (const id of projectedMap.keys()) {
      if (!onDiskIds.has(id)) {
        recordError('MISSING_PROJECTION', `Projected incident #${id} is missing from SQLite database`, {
          incidentId: id
        });
        projectionDriftCount++;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Quarantine Isolation Audit
  // ─────────────────────────────────────────────────────────────
  const quarantinedFiles = [];
  try {
    if (fs.existsSync(quarantineDir)) {
      const files = fs.readdirSync(quarantineDir);
      for (const f of files) {
        quarantinedFiles.push(f);
      }
    }
  } catch {
    // Ignore
  }

  // Determine overall status
  let status = 'TRUSTED';
  let isTrusted = true;

  if (errors.length > 0) {
    status = 'UNTRUSTED';
    isTrusted = false;
  } else if (checkpointLagging) {
    status = 'CRASH_RECOVERY_PENDING';
    isTrusted = true;
  }

  const lastEvent = events.length > 0 ? events[events.length - 1] : null;

  // Compute projection count without redundant replay
  let projectionExamined = 0;
  if (chainIntact && malformed.length === 0) {
    projectionExamined = projectionConsistentCount + projectionDriftCount;
  } else if (events.length > 0) {
    // Chain is broken so Layer 4 was skipped — compute minimally
    projectionExamined = (projectedRecords || projectEventsToRecords(events)).size;
  }

  return {
    status,
    isTrusted,
    journal: {
      examined: events.length,
      valid: validEventsCount,
      malformedCount: malformed.length,
      chainIntact: chainIntact && malformed.length === 0,
      headSequence: lastEvent ? lastEvent.sequence : 0,
      headChainHash: lastEvent ? lastEvent.chainHash : GENESIS_HASH
    },
    checkpoint: {
      present: Boolean(checkpoint),
      matches: checkpointMatches,
      lagging: checkpointLagging,
      headSequence: checkpoint ? checkpoint.headSequence : 0,
      headChainHash: checkpoint ? checkpoint.headChainHash : null
    },
    projections: {
      examined: projectionExamined,
      consistent: projectionConsistentCount,
      driftCount: projectionDriftCount
    },
    quarantine: {
      count: quarantinedFiles.length,
      files: quarantinedFiles
    },
    firstInvalidEvent,
    errors
  };
}

/**
 * Performs a comprehensive read-only integrity audit of the local Rewind ledger
 * by reading the journal from disk.
 *
 * @param {string} ledgerDir
 * @returns {object}
 */
export function verifyLedgerIntegrity(ledgerDir) {
  const journalPath = path.join(ledgerDir, 'journal.jsonl');
  let parseResult = { events: [], malformed: [], totalLines: 0 };
  
  if (fs.existsSync(journalPath)) {
    parseResult = readJournalEvents(journalPath);
  }
  
  return verifyLedgerIntegrityFromEvents({
    events: parseResult.events,
    malformed: parseResult.malformed,
    totalLines: parseResult.totalLines,
    ledgerDir
  });
}
