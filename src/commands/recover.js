import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { MissingArgumentError, CliError, UsageError } from '../errors.js';
import { IncidentStatus, ProvenanceType, assertValidIncidentTransition } from '../storage/state.js';
import { formatJson, formatStatusBadge } from '../formatter.js';
import { sanitizeForDisplay } from '../sanitizer.js';
import { normalizeId } from '../storage/store.js';

/**
 * Safely inspects local workspace for non-secret modified files without external dependencies.
 *
 * @param {string} rootDir
 * @returns {object|null}
 */
function observeLocalChanges(rootDir) {
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
      .filter(f => !path.basename(f).startsWith('.env') && !f.endsWith('.key') && !f.endsWith('.pem') && !f.includes('id_rsa'));

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
 * Handler for `rewind recover <id> [options]`.
 * Records user-provided suspected cause, remediation change, and explicit verification command
 * as a new RecoveryAttempt without overwriting historical failed attempts.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function recoverCommand({ context }) {
  const { parsedArgs, config, storage, stdout, styler } = context;
  const rawId = parsedArgs.positional[0];

  if (!rawId) {
    const { records } = storage.listRecords({ limit: 1, reverse: true });
    let msg = 'rewind recover <id> [--cause "..."] [--change "..."] [--verify-cmd "..."] [--fixed]';
    if (records.length > 0) {
      msg = `rewind recover <id> [--cause "..."] [--change "..."] [--verify-cmd "..."] [--fixed]\n\nTip: The latest incident is #${records[0].id}. Run "rewind recover ${records[0].id}".`;
    }
    throw new MissingArgumentError('id', msg);
  }

  const id = normalizeId(rawId);
  const record = storage.getRecord(id);
  if (!record) {
    throw new CliError(`Incident #${rawId} not found in ledger.`, {
      code: 'ERR_NOT_FOUND',
      exitCode: 1,
      details: { id: rawId, suggestion: 'Run "rewind history" to browse all past incidents.' }
    });
  }

  const cause = parsedArgs.flags.cause;
  const change = parsedArgs.flags.change;
  const verifyCmd = parsedArgs.flags.verifyCmd;
  const isFixed = Boolean(parsedArgs.flags.fixed);

  if (!cause && !change && !verifyCmd && !isFixed) {
    throw new UsageError(
      `Please provide recovery details for Incident #${id} using:\n` +
      `  --cause "<suspected cause>"\n` +
      `  --change "<remediation change made>"\n` +
      `  --verify-cmd "<explicit verification command>"\n` +
      `  --fixed (mark fix as applied by user, unverified)`
    );
  }

  // Validate incident state transition
  assertValidIncidentTransition(record.status, IncidentStatus.OPEN, id);

  // Safely observe local non-secret file changes if available
  const observedChanges = observeLocalChanges(config.rootDir || process.cwd());

  // Append new recovery attempt
  const updated = storage.addRecoveryAttempt(id, {
    cause,
    change,
    verifyCmd,
    isFixed,
    observedChanges
  });

  const latestAttempt = updated.recoveryAttempts[updated.recoveryAttempts.length - 1];

  if (parsedArgs.flags.json) {
    stdout.write(formatJson({
      status: 'success',
      incidentStatus: updated.status,
      attempt: latestAttempt,
      data: updated
    }) + '\n');
    return 0;
  }

  const s = styler;
  const termWidth = (stdout && typeof stdout.columns === 'number' && stdout.columns > 20)
    ? Math.min(stdout.columns, 80)
    : 64;
  const divider = s.dim('─'.repeat(termWidth));

  stdout.write(`\n${s.bold('RECOVERY RECORDED')}  ${s.dim(`[Incident #${id}, Attempt #${latestAttempt.id}]`)}\n`);
  stdout.write(`${divider}\n`);
  stdout.write(`  ${s.dim('Incident Status:'.padEnd(20))} ${formatStatusBadge(updated.status, s)}\n`);
  stdout.write(`  ${s.dim('Attempt Status:'.padEnd(20))} ${formatStatusBadge(latestAttempt.status, s)}${latestAttempt.status === 'FIXED' ? s.yellow(' (User Claim — Unverified)') : ''}\n`);
  stdout.write(`  ${s.dim('Evidence Quality:'.padEnd(20))} ${s.cyan(latestAttempt.evidenceQuality || 'USER_REPORTED')}\n`);

  if (cause) {
    stdout.write(`  ${s.dim('[USER CLAIM] Cause:'.padEnd(20))} ${sanitizeForDisplay(cause)}\n`);
  }
  if (change) {
    stdout.write(`  ${s.dim('[USER CLAIM] Fix:'.padEnd(20))} ${sanitizeForDisplay(change)}\n`);
  }
  if (observedChanges && Array.isArray(observedChanges.files) && observedChanges.files.length > 0) {
    stdout.write(`  ${s.dim('[OBSERVED CHANGE]:'.padEnd(20))} ${s.dim(observedChanges.files.join(', '))}\n`);
  }
  if (verifyCmd) {
    stdout.write(`  ${s.dim('Verify Command:'.padEnd(20))} ${s.cyan(sanitizeForDisplay(verifyCmd))}\n`);
  } else {
    stdout.write(`  ${s.dim('Verification Plan:'.padEnd(20))} ${s.yellow('[INCOMPLETE RECOVERY RECORD — Missing --verify-cmd]')}\n`);
  }
  stdout.write(`${divider}\n`);

  // Show previous failed attempts count if any
  const priorFailedAttempts = updated.recoveryAttempts.filter(a => a.id !== latestAttempt.id && a.status === 'FAILED');
  if (priorFailedAttempts.length > 0) {
    stdout.write(`\n${s.dim(`Note: Incident #${id} has ${priorFailedAttempts.length} prior failed attempt(s) preserved in negative memory.`)}\n`);
  }

  if (verifyCmd) {
    stdout.write(`\nNext Step:\n  Run "${s.cyan(`rewind verify ${id}`)}" to execute the verification command and seal this recovery.\n\n`);
  } else {
    stdout.write(`\nNext Step:\n  Record the explicit verification command with "${s.cyan(`rewind recover ${id} --verify-cmd "<command>"`)}".\n\n`);
  }

  return 0;
}

