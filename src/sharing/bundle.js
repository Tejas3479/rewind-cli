import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { redactSecrets, sanitizeForDisplay } from '../sanitizer.js';
import { IncidentStatus, RecoveryAttemptStatus, ProvenanceType, EvidenceQuality } from '../storage/state.js';
import { CliError } from '../errors.js';
import { VERSION } from '../config.js';

export const CURRENT_BUNDLE_SCHEMA_VERSION = 1;
export const BUNDLE_FORMAT_IDENTIFIER = 'REWIND_SHARED_RECOVERY_BUNDLE';
export const DEFAULT_SHARED_BUNDLE_FILENAME = 'shared-recovery.json';

/**
 * Strips machine-specific absolute path prefixes and home directories from a string.
 *
 * @param {string} text
 * @param {string} [rootDir]
 * @returns {string}
 */
export function stripMachinePaths(text, rootDir = '') {
  if (!text || typeof text !== 'string') return '';

  let sanitized = text;

  // Replace explicit rootDir if provided
  if (rootDir && typeof rootDir === 'string' && rootDir.trim()) {
    const normalizedRoot = rootDir.replace(/\\/g, '/');
    const winRoot = rootDir.replace(/\//g, '\\');
    sanitized = sanitized.replaceAll(normalizedRoot, '<WORKSPACE_ROOT>');
    sanitized = sanitized.replaceAll(winRoot, '<WORKSPACE_ROOT>');
  }

  // Replace standard POSIX user home directories: /Users/<user>/... or /home/<user>/...
  sanitized = sanitized.replace(/(?:\/Users|\/home)\/[a-zA-Z0-9._-]+\//g, '<WORKSPACE_ROOT>/');

  // Replace standard Windows user home directories: C:\Users\<user>\...
  sanitized = sanitized.replace(/[a-zA-Z]:\\Users\\[a-zA-Z0-9._-]+\\/gi, '<WORKSPACE_ROOT>\\');

  return sanitized;
}

/**
 * Sanitizes an incident record for external bundle sharing.
 * Strips absolute paths, removes local machine IDs, redacts secrets,
 * and preserves diagnostic error structures, provenance, and verification evidence.
 *
 * @param {import('../storage/record.js').IncidentRecord} record
 * @param {string} [rootDir]
 * @returns {object}
 */
export function sanitizeBundleIncident(record, rootDir = '') {
  if (!record) return null;

  // Redact secrets and strip machine paths from commands
  const cleanCommand = stripMachinePaths(redactSecrets(record.command || ''), rootDir);
  const cleanArgs = (Array.isArray(record.args) ? record.args : []).map(a =>
    stripMachinePaths(redactSecrets(a || ''), rootDir)
  );
  const cleanFullCommand = stripMachinePaths(redactSecrets(record.fullCommand || ''), rootDir);
  const cleanStderr = stripMachinePaths(redactSecrets(record.stderr || ''), rootDir);
  const cleanNormalizedError = stripMachinePaths(redactSecrets(record.normalizedError || ''), rootDir);

  // Sanitize diagnostic structures
  let cleanDiagnostic = null;
  if (record.diagnostic) {
    cleanDiagnostic = {
      language: record.diagnostic.language || null,
      runtime: record.diagnostic.runtime || null,
      errorType: record.diagnostic.errorType || null,
      errorCode: record.diagnostic.errorCode || null,
      message: stripMachinePaths(redactSecrets(record.diagnostic.message || ''), rootDir),
      sourceFile: record.diagnostic.sourceFile ? stripMachinePaths(record.diagnostic.sourceFile, rootDir) : null,
      line: record.diagnostic.line || null,
      column: record.diagnostic.column || null,
      confidence: record.diagnostic.confidence || 'UNKNOWN',
      stackFrames: (Array.isArray(record.diagnostic.stackFrames) ? record.diagnostic.stackFrames : []).map(f => ({
        ...f,
        file: f.file ? stripMachinePaths(f.file, rootDir) : null,
        callee: f.callee ? redactSecrets(f.callee) : null
      }))
    };
  }

  // Safe public environment (no local username, hostname, or local paths)
  const cleanEnv = record.environment ? {
    platform: record.environment.platform || null,
    arch: record.environment.arch || null,
    nodeVersion: record.environment.nodeVersion || null,
    nodeMajor: record.environment.nodeMajor || null,
    osRelease: record.environment.osRelease || null
  } : {};

  // Sanitize recovery attempts and verification evidence
  const cleanAttempts = (Array.isArray(record.recoveryAttempts) ? record.recoveryAttempts : []).map((att, idx) => {
    const runs = (Array.isArray(att.verificationRuns) ? att.verificationRuns : []);
    const verifiedRun = runs.find(r => r.result === 'PASSED' || r.exitCode === 0) || runs[runs.length - 1];

    return {
      attemptId: att.id || (idx + 1),
      createdAt: att.createdAt || record.startTime,
      cause: att.cause ? stripMachinePaths(redactSecrets(att.cause), rootDir) : null,
      causeProvenance: att.causeProvenance || ProvenanceType.USER_REPORTED,
      change: att.change ? stripMachinePaths(redactSecrets(att.change), rootDir) : null,
      changeProvenance: att.changeProvenance || ProvenanceType.USER_REPORTED,
      verifyCmd: att.verifyCmd ? stripMachinePaths(redactSecrets(att.verifyCmd), rootDir) : null,
      verifyCmdProvenance: att.verifyCmdProvenance || ProvenanceType.USER_REPORTED,
      status: att.status || RecoveryAttemptStatus.PROPOSED,
      evidenceQuality: att.evidenceQuality || (att.status === 'VERIFIED' ? EvidenceQuality.DIRECT : EvidenceQuality.UNVERIFIED),
      verificationEvidence: verifiedRun ? {
        runId: verifiedRun.id,
        exitCode: verifiedRun.exitCode,
        durationMs: verifiedRun.durationMs,
        verifiedAt: verifiedRun.completedAt || verifiedRun.startedAt || att.createdAt,
        outputHash: verifiedRun.outputHash || '',
        result: verifiedRun.result || 'PASSED'
      } : null
    };
  });

  return {
    originalIncidentId: String(record.id),
    fingerprint: record.fingerprint,
    command: cleanCommand,
    args: cleanArgs,
    fullCommand: cleanFullCommand,
    normalizedError: cleanNormalizedError,
    exitCode: record.exitCode ?? 1,
    durationMs: record.durationMs || 0,
    startTime: record.startTime,
    endTime: record.endTime,
    stderr: cleanStderr,
    diagnostic: cleanDiagnostic,
    environment: cleanEnv,
    git: {
      isGit: Boolean(record.git?.isGit),
      branch: record.git?.branch || null
    },
    recoveryAttempts: cleanAttempts
  };
}

/**
 * Exports verified recovery knowledge from local ledger into a portable shared bundle.
 *
 * @param {object} params
 * @param {import('../storage/store.js').StorageEngine} params.storage
 * @param {string} params.rootDir
 * @param {string} [params.outputPath]
 * @param {boolean} [params.includeUnverified=false]
 * @returns {{ bundle: object, outputPath: string, totalIncidents: number, totalVerifiedRecoveries: number }}
 */
export function exportRecoveryBundle({
  storage,
  rootDir,
  outputPath = null,
  includeUnverified = false
}) {
  if (!storage) {
    throw new CliError('Storage engine is required for export.');
  }

  const { records: allRecords } = storage.listRecords();
  const candidateRecords = includeUnverified
    ? allRecords
    : allRecords.filter(r =>
        r.status === IncidentStatus.RECOVERED ||
        (Array.isArray(r.recoveryAttempts) && r.recoveryAttempts.some(a => a.status === RecoveryAttemptStatus.VERIFIED))
      );

  const sanitizedIncidents = candidateRecords
    .map(r => sanitizeBundleIncident(r, rootDir))
    .filter(Boolean);

  let verifiedRecoveriesCount = 0;
  for (const inc of sanitizedIncidents) {
    for (const att of inc.recoveryAttempts) {
      if (att.status === RecoveryAttemptStatus.VERIFIED) {
        verifiedRecoveriesCount++;
      }
    }
  }

  // Compute canonical digest of exported incident contents
  const bundlePayloadString = JSON.stringify(sanitizedIncidents);
  const bundleFingerprint = crypto.createHash('sha256').update(bundlePayloadString, 'utf8').digest('hex');

  const bundle = {
    $schema: 'https://rewind.dev/schemas/v1/shared-recovery.json',
    format: BUNDLE_FORMAT_IDENTIFIER,
    schemaVersion: CURRENT_BUNDLE_SCHEMA_VERSION,
    producerVersion: VERSION,
    exportedAt: new Date().toISOString(),
    generator: 'rewind export-shared',
    bundleFingerprint,
    metadata: {
      totalIncidents: sanitizedIncidents.length,
      totalVerifiedRecoveries: verifiedRecoveriesCount,
      description: 'Shared recovery knowledge bundle for team collaboration',
      includedUnverified: includeUnverified
    },
    incidents: sanitizedIncidents
  };

  const targetPath = outputPath
    ? path.resolve(outputPath)
    : path.join(rootDir, DEFAULT_SHARED_BUNDLE_FILENAME);

  // Write bundle file safely
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(targetPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');

  return {
    bundle,
    outputPath: targetPath,
    totalIncidents: sanitizedIncidents.length,
    totalVerifiedRecoveries: verifiedRecoveriesCount
  };
}

/**
 * Validates the structure and schema version of a shared recovery bundle.
 *
 * @param {unknown} bundleData
 * @returns {object} Validated bundle data
 */
export function validateBundleStructure(bundleData) {
  if (!bundleData || typeof bundleData !== 'object') {
    throw new CliError('Corrupted bundle: Expected a valid JSON object.', {
      code: 'ERR_CORRUPT_BUNDLE'
    });
  }

  if (bundleData.format !== BUNDLE_FORMAT_IDENTIFIER) {
    throw new CliError(`Invalid bundle format: Expected format "${BUNDLE_FORMAT_IDENTIFIER}", got "${bundleData.format || 'unknown'}".`, {
      code: 'ERR_INVALID_BUNDLE_FORMAT'
    });
  }

  if (typeof bundleData.schemaVersion !== 'number') {
    throw new CliError('Corrupted bundle: Missing schemaVersion property.', {
      code: 'ERR_CORRUPT_BUNDLE'
    });
  }

  if (bundleData.schemaVersion > CURRENT_BUNDLE_SCHEMA_VERSION) {
    throw new CliError(
      `Unsupported bundle schema version: ${bundleData.schemaVersion}. ` +
      `This version of Rewind supports schema version ${CURRENT_BUNDLE_SCHEMA_VERSION}. Please upgrade Rewind to import this bundle.`,
      {
        code: 'ERR_UNSUPPORTED_SCHEMA_VERSION'
      }
    );
  }

  if (!Array.isArray(bundleData.incidents)) {
    throw new CliError('Corrupted bundle: Missing or invalid "incidents" list.', {
      code: 'ERR_CORRUPT_BUNDLE'
    });
  }

  return bundleData;
}

/**
 * Imports recovery records from a shared bundle into the local ledger.
 *
 * Invariants:
 * 1. Imported verified recoveries are marked "VERIFIED — EXTERNAL EVIDENCE" (Quality: SUPPORTED).
 * 2. Does NOT imply local verification. Local verification requires running "rewind verify <id>".
 * 3. Idempotent: Skips duplicate incidents that are already recorded.
 *
 * @param {object} params
 * @param {import('../storage/store.js').StorageEngine} params.storage
 * @param {string|object} params.bundle - File path or parsed bundle object
 * @param {string} params.rootDir
 * @param {boolean} [params.dryRun=false]
 * @param {boolean} [params.overwrite=false]
 * @returns {{ importedCount: number, skippedCount: number, totalVerifiedRecoveries: number, importedIncidents: Array<object> }}
 */
export function importRecoveryBundle({
  storage,
  bundle,
  rootDir,
  dryRun = false,
  overwrite = false
}) {
  let bundleData;

  if (typeof bundle === 'string') {
    if (!fs.existsSync(bundle)) {
      throw new CliError(`Bundle file not found: "${bundle}".`, {
        code: 'ERR_FILE_NOT_FOUND'
      });
    }
    try {
      const content = fs.readFileSync(bundle, 'utf8');
      bundleData = JSON.parse(content);
    } catch (err) {
      throw new CliError(`Corrupted bundle file: "${bundle}". Invalid JSON syntax: ${err.message}`, {
        code: 'ERR_CORRUPT_BUNDLE'
      });
    }
  } else {
    bundleData = bundle;
  }

  validateBundleStructure(bundleData);

  const { records: existingRecords } = storage.listRecords();
  const importedIncidents = [];
  let skippedCount = 0;
  let totalVerifiedCount = 0;

  for (const importedInc of bundleData.incidents) {
    if (!importedInc || !importedInc.fingerprint) {
      continue;
    }

    // Check for existing duplicate incident with identical fingerprint and attempts
    const existingMatch = existingRecords.find(r => r.fingerprint === importedInc.fingerprint);

    let isDuplicate = false;
    if (existingMatch && !overwrite) {
      // Check if attempts already match
      const importedAttempts = Array.isArray(importedInc.recoveryAttempts) ? importedInc.recoveryAttempts : [];
      const existingAttempts = Array.isArray(existingMatch.recoveryAttempts) ? existingMatch.recoveryAttempts : [];

      const allAttemptsAlreadyPresent = importedAttempts.every(impAtt =>
        existingAttempts.some(exAtt =>
          exAtt.cause === impAtt.cause &&
          exAtt.change === impAtt.change &&
          exAtt.verifyCmd === impAtt.verifyCmd
        )
      );

      if (allAttemptsAlreadyPresent && importedAttempts.length > 0) {
        isDuplicate = true;
      }
    }

    if (isDuplicate) {
      skippedCount++;
      continue;
    }

    // Prepare imported recovery attempts
    const processedAttempts = (Array.isArray(importedInc.recoveryAttempts) ? importedInc.recoveryAttempts : []).map((att, idx) => {
      const isVerified = att.status === RecoveryAttemptStatus.VERIFIED;
      if (isVerified) totalVerifiedCount++;

      return {
        id: idx + 1,
        createdAt: att.createdAt || importedInc.startTime || new Date().toISOString(),
        cause: att.cause || null,
        causeProvenance: att.causeProvenance || ProvenanceType.USER_REPORTED,
        change: att.change || null,
        changeProvenance: att.changeProvenance || ProvenanceType.USER_REPORTED,
        verifyCmd: att.verifyCmd || null,
        verifyCmdProvenance: att.verifyCmdProvenance || ProvenanceType.USER_REPORTED,
        observedChanges: null,
        status: att.status || RecoveryAttemptStatus.PROPOSED,
        // Mark as external evidence quality
        isExternal: isVerified,
        evidenceQuality: isVerified ? EvidenceQuality.SUPPORTED : EvidenceQuality.UNVERIFIED,
        externalVerification: att.verificationEvidence || null,
        verificationRuns: [] // Local verification runs remain empty until locally verified!
      };
    });

    const incidentToPersist = {
      fingerprint: importedInc.fingerprint || undefined,
      normalizedError: importedInc.normalizedError || undefined,
      command: importedInc.command || '',
      args: Array.isArray(importedInc.args) ? importedInc.args : [],
      fullCommand: importedInc.fullCommand || importedInc.command || '',
      cwd: rootDir || process.cwd(),
      startTime: importedInc.startTime || new Date().toISOString(),
      endTime: importedInc.endTime || new Date().toISOString(),
      durationMs: importedInc.durationMs || 0,
      exitCode: importedInc.exitCode ?? 1,
      signal: null,
      timedOut: false,
      success: false,
      stdoutRaw: '',
      stderrRaw: importedInc.stderr || '',
      stdout: '',
      stderr: importedInc.stderr || '',
      diagnostic: importedInc.diagnostic || null,
      isTruncated: false,
      git: importedInc.git || { isGit: false },
      environment: importedInc.environment || {}
    };

    if (!dryRun) {
      // Save incident to local storage
      const saved = storage.saveRecord(incidentToPersist);

      // Add each recovery attempt
      for (const att of processedAttempts) {
        storage.addRecoveryAttempt(saved.id, {
          cause: att.cause,
          causeProvenance: att.causeProvenance,
          change: att.change,
          changeProvenance: att.changeProvenance,
          verifyCmd: att.verifyCmd,
          verifyCmdProvenance: att.verifyCmdProvenance,
          isFixed: att.status === RecoveryAttemptStatus.FIXED,
          isExternal: att.isExternal,
          status: att.status,
          evidenceQuality: att.evidenceQuality,
          externalVerification: att.externalVerification
        });
      }

      importedIncidents.push(storage.getRecord(saved.id));
    } else {
      importedIncidents.push({
        ...incidentToPersist,
        id: `preview-${importedIncidents.length + 1}`,
        recoveryAttempts: processedAttempts
      });
    }
  }

  return {
    importedCount: importedIncidents.length,
    skippedCount,
    totalVerifiedRecoveries: totalVerifiedCount,
    importedIncidents
  };
}
