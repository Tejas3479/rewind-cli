import { execFileSync } from 'node:child_process';
import { IncidentStatus, RecoveryAttemptStatus, ProvenanceType, assertValidIncidentTransition } from '../storage/state.js';
import { executeAndCapture } from '../capture.js';
import { tokenizeCommandLine, hasShellOperators } from '../parser.js';
import { normalizeId } from '../storage/store.js';
import { sanitizeForDisplay } from '../sanitizer.js';
import { formatStatusBadge, formatBox, formatUtc } from '../formatter.js';
import { CliError } from '../errors.js';

/**
 * Safely inspects local workspace for non-secret modified files without external dependencies.
 *
 * @param {string} rootDir
 * @returns {object|null}
 */
export function observeSafeWorkspaceChanges(rootDir) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: rootDir,
      timeout: 2000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const files = out
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.slice(3).trim())
      .filter(f => !/(^|[/\\])\.env/i.test(f) && !f.endsWith('.key') && !f.endsWith('.pem') && !f.includes('id_rsa'));

    if (files.length > 0) {
      return {
        files: files.slice(0, 10),
        count: files.length,
        provenance: ProvenanceType.AUTOMATICALLY_OBSERVED
      };
    }
  } catch {
    // Non-fatal: git not installed or not in a git working tree
  }
  return null;
}

/**
 * Retrieves candidate incidents from storage for triage selection.
 *
 * @param {import('../storage/store.js').StorageEngine} storage
 * @returns {{ all: import('../storage/record.js').IncidentRecord[], unrecovered: import('../storage/record.js').IncidentRecord[] }}
 */
export function getTriageCandidateIncidents(storage) {
  const { records: all } = storage.listRecords({ limit: 50, reverse: true });
  const unrecovered = all.filter(r => r.status !== IncidentStatus.RECOVERED && r.status !== IncidentStatus.RESOLVED && r.status !== 'VERIFIED');
  return { all, unrecovered };
}

/**
 * Validates and retrieves an incident record for triage.
 *
 * @param {import('../storage/store.js').StorageEngine} storage
 * @param {string|number} rawId
 * @returns {import('../storage/record.js').IncidentRecord}
 */
export function getIncidentForTriage(storage, rawId) {
  const id = normalizeId(rawId);
  const record = storage.getRecord(id);
  if (!record) {
    throw new CliError(`Incident #${rawId} not found in ledger.`, {
      code: 'ERR_NOT_FOUND',
      exitCode: 1,
      details: { id: rawId, suggestion: 'Run "rewind history" to browse all past incidents.' }
    });
  }
  return record;
}

/**
 * Formats a concise summary of an incident for display in triage Step 2.
 *
 * @param {import('../storage/record.js').IncidentRecord} record
 * @param {import('../formatter.js').createStyler} s
 * @returns {string}
 */
export function formatIncidentSummary(record, s) {
  const lines = [];
  const divider = s.dim('─'.repeat(64));

  lines.push(`\n${s.bold(`INCIDENT #${record.id}`)}  ${formatStatusBadge(record.status, s)}`);
  lines.push(divider);
  lines.push(`  ${s.dim('Command:'.padEnd(16))} ${s.bold(sanitizeForDisplay(record.fullCommand || record.command))}`);
  lines.push(`  ${s.dim('Exit Code:'.padEnd(16))} ${s.red(String(record.exitCode))} ${s.dim(`(${record.durationMs || 0}ms)`)}`);
  lines.push(`  ${s.dim('Started At:'.padEnd(16))} ${formatUtc(record.startTime)}`);

  // Diagnostic or stderr snippet
  if (record.diagnostic && record.diagnostic.confidence !== 'UNKNOWN') {
    const d = record.diagnostic;
    const diagParts = [];
    if (d.language) diagParts.push(`[${d.language.toUpperCase()}]`);
    if (d.errorType) diagParts.push(d.errorType);
    if (d.errorCode) diagParts.push(`(${d.errorCode})`);
    const diagHeader = diagParts.join(' ');
    lines.push(`  ${s.dim('Diagnostic:'.padEnd(16))} ${s.yellow(diagHeader)}`);
    if (d.message) {
      lines.push(`  ${s.dim('Error Message:'.padEnd(16))} ${sanitizeForDisplay(d.message)}`);
    }
    if (d.sourceFile) {
      const loc = `${d.sourceFile}${d.line ? `:${d.line}` : ''}${d.column ? `:${d.column}` : ''}`;
      lines.push(`  ${s.dim('Location:'.padEnd(16))} ${s.cyan(loc)}`);
    }
  } else if (record.stderr) {
    const firstLine = record.stderr.split(/\r?\n/).find(l => l.trim().length > 0) || 'Unknown error';
    lines.push(`  ${s.dim('Error Output:'.padEnd(16))} ${s.dim(sanitizeForDisplay(firstLine.slice(0, 80)))}`);
  }

  // Prior failed attempts warning
  const attempts = Array.isArray(record.recoveryAttempts) ? record.recoveryAttempts : [];
  const priorFailed = attempts.filter(a => a.status === 'FAILED');
  if (priorFailed.length > 0) {
    lines.push(`  ${s.dim('Failed Tries:'.padEnd(16))} ${s.red(`${priorFailed.length} prior failed attempt(s) in negative memory`)}`);
  }

  lines.push(divider);
  return lines.join('\n');
}

/**
 * Formats the review screen for Step 6.
 *
 * @param {object} params
 * @param {string|null} params.cause
 * @param {string|null} params.change
 * @param {string|null} params.verifyCmd
 * @param {import('../formatter.js').createStyler} s
 * @returns {string}
 */
export function formatReviewScreen({ cause, change, verifyCmd }, s) {
  const items = [
    { label: 'CAUSE', value: cause ? sanitizeForDisplay(cause) : s.dim('(None specified)') },
    { label: 'CHANGE', value: change ? sanitizeForDisplay(change) : s.dim('(None specified)') },
    { label: 'VERIFY', value: verifyCmd ? s.cyan(sanitizeForDisplay(verifyCmd)) : s.dim('(None specified)') },
    { label: 'STATUS', value: s.yellow('FIXED — NOT YET VERIFIED') }
  ];

  return formatBox('RECOVERY REVIEW', items, s, 'info');
}

/**
 * Records a recovery attempt into the authoritative ledger with FIXED (unverified) state.
 *
 * @param {import('../storage/store.js').StorageEngine} storage
 * @param {object} params
 * @param {string|number} params.incidentId
 * @param {string|null} params.cause
 * @param {string|null} params.change
 * @param {string|null} params.verifyCmd
 * @param {object|null} [params.observedChanges]
 * @returns {{ updatedRecord: import('../storage/record.js').IncidentRecord, attempt: import('../storage/record.js').RecoveryAttempt }}
 */
export function recordTriageRecovery(storage, { incidentId, cause, change, verifyCmd, observedChanges = null }) {
  const id = normalizeId(incidentId);
  const existing = storage.getRecord(id);
  if (!existing) {
    throw new CliError(`Incident #${id} not found in ledger.`, { code: 'ERR_NOT_FOUND', exitCode: 1 });
  }

  assertValidIncidentTransition(existing.status, IncidentStatus.OPEN, id);

  const updatedRecord = storage.addRecoveryAttempt(id, {
    cause: cause || null,
    change: change || null,
    verifyCmd: verifyCmd || null,
    isFixed: true,
    observedChanges
  });

  const attempts = updatedRecord.recoveryAttempts || [];
  const attempt = attempts[attempts.length - 1];

  return { updatedRecord, attempt };
}

/**
 * Executes verification for a triage recovery attempt.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @param {string|number} params.incidentId
 * @param {number} params.attemptId
 * @param {string} params.verifyCmd
 * @param {number} [params.timeoutMs=60000]
 * @param {boolean} [params.shell=false]
 * @returns {Promise<{
 *   success: boolean,
 *   exitCode: number,
 *   timedOut: boolean,
 *   durationMs: number,
 *   updatedRecord: import('../storage/record.js').IncidentRecord,
 *   conflictReport: object
 * }>}
 */
export async function executeTriageVerification({
  context,
  incidentId,
  attemptId,
  verifyCmd,
  timeoutMs = 60000,
  shell = false
}) {
  const { storage, config, env, stdout, stderr } = context;
  const id = normalizeId(incidentId);

  const isShellCommand = Boolean(shell) || hasShellOperators(verifyCmd);
  const commandTokens = isShellCommand ? [verifyCmd] : tokenizeCommandLine(verifyCmd);

  const verifyResult = await executeAndCapture(commandTokens, {
    cwd: config.rootDir,
    env,
    stdoutStream: stdout,
    stderrStream: stderr,
    shell: isShellCommand,
    timeout: timeoutMs
  });

  const runOutput = (verifyResult.stdout || verifyResult.stderr || '').trim();
  const isSuccess = Boolean(verifyResult.success && verifyResult.exitCode === 0);
  const exitCode = typeof verifyResult.exitCode === 'number' ? verifyResult.exitCode : (isSuccess ? 0 : 1);

  const updatedRecord = storage.recordVerificationRun(id, attemptId, {
    command: verifyCmd,
    exitCode,
    durationMs: verifyResult.durationMs,
    output: runOutput
  });

  const conflictReport = storage.getContradictionReport(updatedRecord.fingerprint);

  return {
    success: isSuccess,
    exitCode,
    timedOut: Boolean(verifyResult.timedOut),
    durationMs: verifyResult.durationMs,
    updatedRecord,
    conflictReport
  };
}
