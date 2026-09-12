import { MissingArgumentError, CliError } from '../errors.js';
import { formatJson, formatStatusBadge, formatUtc } from '../formatter.js';
import { sanitizeForDisplay } from '../sanitizer.js';
import { normalizeId } from '../storage/store.js';
import { formatNegativeMemorySection } from '../storage/negative_memory.js';
import { formatContradictionSection } from '../storage/contradiction.js';

/**
 * Handler for `rewind show <id> [options]`.
 * Displays complete inspectable forensic record with full attempt history,
 * verification runs, negative memory, staleness analysis, and contradiction alerts.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function showCommand({ context }) {
  const { parsedArgs, storage, stdout, styler } = context;
  const rawId = parsedArgs.positional[0];

  if (!rawId) {
    const { records } = storage.listRecords({ limit: 1, reverse: true });
    let msg = 'rewind show <id> [--json]';
    if (records.length > 0) {
      msg = `rewind show <id> [--json]\n\nTip: The latest incident is #${records[0].id}. Run "rewind show ${records[0].id}".`;
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

  const stalenessReport = storage.getStalenessReport(id);
  const failedApproaches = storage.getNegativeMemory(record.fingerprint);
  const conflictReport = storage.getContradictionReport(record.fingerprint);

  if (parsedArgs.flags.json) {
    stdout.write(formatJson({
      status: 'success',
      data: record,
      intelligence: {
        staleness: stalenessReport,
        negativeMemory: failedApproaches,
        conflicts: conflictReport
      }
    }) + '\n');
    return 0;
  }

  const s = styler;
  const termWidth = (stdout && typeof stdout.columns === 'number' && stdout.columns > 20)
    ? Math.min(stdout.columns, 80)
    : 80;
  const divider = s.dim('─'.repeat(termWidth));

  stdout.write(`\n${s.bold(`INCIDENT #${record.id}`)}  ${formatStatusBadge(record.status, s)}\n`);
  stdout.write(`${divider}\n`);

  // Section 1: Execution Details
  stdout.write(`${s.bold('EXECUTION:')}\n`);
  stdout.write(`  ${s.dim('Command:')}      ${s.cyan(sanitizeForDisplay(record.fullCommand || `${record.command} ${(record.args || []).join(' ')}`))}\n`);
  stdout.write(`  ${s.dim('Exit Code:')}    ${record.exitCode !== null ? s.bold(String(record.exitCode)) : s.dim('null')}${record.signal ? ` (Signal: ${record.signal})` : ''}\n`);
  stdout.write(`  ${s.dim('Duration:')}     ${record.durationMs}ms\n`);
  stdout.write(`  ${s.dim('Started At:')}   ${formatUtc(record.startTime)}\n`);
  stdout.write(`  ${s.dim('Working Dir:')}  ${record.cwd}\n`);
  if (record.regressionOf) {
    stdout.write(`  ${s.dim('Regression Of:')} ${s.red(s.bold(`Incident #${record.regressionOf}`))}\n`);
  }
  if (record.evidenceHash) {
    stdout.write(`  ${s.dim('Evidence Hash:')} ${s.dim(record.evidenceHash.slice(0, 16))}...\n`);
  }
  stdout.write('\n');

  // Section 2: Failure Signature & Fingerprint
  stdout.write(`${s.bold('FAILURE SIGNATURE:')}\n`);
  stdout.write(`  ${s.dim('Fingerprint:'.padEnd(14))} ${s.cyan(record.fingerprint || 'none')}\n`);
  if (record.normalizedError) {
    stdout.write(`  ${s.dim('Normalized Signature:')}\n`);
    const cleanNorm = sanitizeForDisplay(record.normalizedError);
    const normLines = cleanNorm.split('\n').map((l) => `    ${s.yellow(l)}`).join('\n');
    stdout.write(`${normLines}\n`);
  }
  stdout.write('\n');

  // Section 2.5: Structured Diagnostic
  const diag = record.diagnostic;
  if (diag && diag.language) {
    stdout.write(`${s.bold('STRUCTURED DIAGNOSTIC:')}\n`);
    stdout.write(`  ${s.dim('Language:'.padEnd(18))} ${s.cyan(diag.language.toUpperCase())}${diag.runtime ? ` (${diag.runtime})` : ''} ${s.dim(`[Confidence: ${diag.confidence}]`)}\n`);
    if (diag.errorType) stdout.write(`  ${s.dim('Error Type:'.padEnd(18))} ${s.bold(s.red(diag.errorType))}\n`);
    if (diag.errorCode) stdout.write(`  ${s.dim('Error Code:'.padEnd(18))} ${s.yellow(diag.errorCode)}\n`);
    if (diag.sourceFile) {
      const locStr = `${diag.sourceFile}${diag.line ? `:${diag.line}` : ''}${diag.column ? `:${diag.column}` : ''}`;
      stdout.write(`  ${s.dim('Primary Location:'.padEnd(18))} ${s.bold(locStr)}\n`);
    }
    if (diag.message) {
      stdout.write(`  ${s.dim('Message:'.padEnd(18))} ${sanitizeForDisplay(diag.message)}\n`);
    }
    if (Array.isArray(diag.stackFrames) && diag.stackFrames.length > 0) {
      stdout.write(`  ${s.dim('Call Stack:'.padEnd(18))} ${s.dim(`(${diag.stackFrames.length} frame(s) identified)`)}\n`);
      for (let fi = 0; fi < Math.min(diag.stackFrames.length, 3); fi++) {
        const frame = diag.stackFrames[fi];
        const fnName = frame.function ? `${frame.function} ` : '';
        const loc = frame.file ? `(${frame.file}:${frame.line || '?'}:${frame.column || '?'})` : frame.raw;
        stdout.write(`    ${s.dim('•')} ${fnName}${s.dim(loc)}\n`);
      }
    }
    stdout.write('\n');
  }

  // Section 3: Captured Stderr & Stdout Evidence
  if (record.stderr && record.stderr.trim()) {
    stdout.write(`${s.bold('CAPTURED STDERR:')}\n`);
    const cleanStderr = sanitizeForDisplay(record.stderr);
    const errLines = cleanStderr.split('\n').map((l) => `  ${l}`).join('\n');
    stdout.write(`${errLines}\n\n`);
  }

  if (record.stdout && record.stdout.trim()) {
    stdout.write(`${s.bold('CAPTURED STDOUT:')}\n`);
    const cleanStdout = sanitizeForDisplay(record.stdout);
    const outLines = cleanStdout.split('\n').map((l) => `  ${l}`).join('\n');
    stdout.write(`${outLines}\n\n`);
  }

  // Section 4: Environment & Repository Metadata
  stdout.write(`${s.bold('ENVIRONMENT & REPOSITORY:')}\n`);
  
  if (stalenessReport && stalenessReport.diffs) {
    const diffs = stalenessReport.diffs;

    // Git
    const gitMsg = diffs.git.diverged
      ? `${s.red(`historical: ${diffs.git.historicalBranch} (${diffs.git.historicalCommit})`)} -> ${s.green(`current: ${diffs.git.currentBranch} (${diffs.git.currentCommit})`)}`
      : `${diffs.git.historicalBranch} (${diffs.git.historicalCommit})`;
    stdout.write(`  ${s.dim('Git:'.padEnd(14))} ${gitMsg}\n`);

    // Platform & Arch
    const platMsg = diffs.platform.changed
      ? `${s.red(diffs.platform.historical)} -> ${s.green(diffs.platform.current)}`
      : diffs.platform.historical;
    const archMsg = diffs.arch.changed
      ? `${s.red(diffs.arch.historical)} -> ${s.green(diffs.arch.current)}`
      : diffs.arch.historical;
    stdout.write(`  ${s.dim('Platform:'.padEnd(14))} ${platMsg} (${archMsg})\n`);

    // Runtime
    const rtMsg = diffs.runtime.changed
      ? `${s.red(diffs.runtime.historical)} -> ${s.green(diffs.runtime.current)}`
      : diffs.runtime.historical;
    stdout.write(`  ${s.dim('Runtime:'.padEnd(14))} Node.js ${rtMsg}\n`);
  } else {
    // Fallback if staleness report is missing
    if (record.git && record.git.isGit) {
      stdout.write(`  ${s.dim('Git Branch:'.padEnd(14))} ${record.git.branch || s.dim('detached')} (${record.git.headCommit ? record.git.headCommit.slice(0, 10) : 'none'})\n`);
    }
    if (record.environment) {
      stdout.write(`  ${s.dim('Platform:'.padEnd(14))} ${record.environment.platform} (${record.environment.arch}) / OS ${record.environment.osRelease}\n`);
      stdout.write(`  ${s.dim('Runtime:'.padEnd(14))} Node.js ${record.environment.nodeVersion}\n`);
    }
  }

  if (record.environment && record.environment.envKeysHash) {
    stdout.write(`  ${s.dim('Env Keys:'.padEnd(14))} ${s.dim(record.environment.envKeysHash)} (hash)\n`);
  }
  stdout.write('\n');

  // Section 5: Recovery History & Verification Runs
  const attempts = Array.isArray(record.recoveryAttempts) ? record.recoveryAttempts : [];
  if (attempts.length > 0) {
    stdout.write(`${s.bold(`RECOVERY ATTEMPTS (${attempts.length} recorded):`)}\n`);
    for (const att of attempts) {
      const attBadge = formatStatusBadge(att.status, s);
      const qualityTag = att.evidenceQuality ? s.dim(`[Quality: ${att.evidenceQuality}]`) : '';
      const fixedTag = att.status === 'FIXED'
        ? s.yellow(' (User Claim — Unverified)')
        : att.isExternal
          ? s.cyan(' (External Evidence — Unverified Locally)')
          : '';
      stdout.write(`  ${s.bold(`[Attempt #${att.id}]`)} ${attBadge}${fixedTag} ${qualityTag} ${s.dim(`(${formatUtc(att.createdAt)})`)}\n`);

      if (att.isExternal) {
        stdout.write(`    ${s.dim('Source:'.padEnd(26))} ${s.dim('Imported from shared recovery bundle')}\n`);
        stdout.write(`    ${s.dim('Local Verification:'.padEnd(26))} ${s.yellow(`Run "rewind verify ${record.id}" to verify locally on this machine`)}\n`);
      }

      if (att.cause) {
        stdout.write(`    ${s.dim('[USER CLAIM] Hypothesis:'.padEnd(26))} ${sanitizeForDisplay(att.cause)}\n`);
      }
      if (att.change) {
        stdout.write(`    ${s.dim('[USER CLAIM] Attempted Fix:'.padEnd(26))} ${sanitizeForDisplay(att.change)}\n`);
      }
      if (att.observedChanges && Array.isArray(att.observedChanges.files) && att.observedChanges.files.length > 0) {
        stdout.write(`    ${s.dim('[OBSERVED CHANGE] Files:'.padEnd(26))} ${s.dim(att.observedChanges.files.join(', '))}\n`);
      }
      if (att.verifyCmd) {
        stdout.write(`    ${s.dim('Verify Command:'.padEnd(26))} ${s.cyan(sanitizeForDisplay(att.verifyCmd))}\n`);
      }

      const runs = Array.isArray(att.verificationRuns) ? att.verificationRuns : [];
      if (runs.length > 0) {
        stdout.write(`    ${s.dim('Verification Runs:')}\n`);
        for (const run of runs) {
          const runBadge = run.result === 'PASSED' ? s.green('✓ PASSED (Exit 0)') : s.red(`✗ FAILED (Exit ${run.exitCode})`);
          stdout.write(`      • ${s.dim('[VERIFIED RESULT]')} ${runBadge} ${s.dim(`(${run.durationMs}ms at ${formatUtc(run.completedAt)})`)}\n`);
        }
      }
      stdout.write('\n');
    }
  }

  // Section 6: Known Failed Approaches (Negative Memory)
  if (failedApproaches.length > 0) {
    stdout.write(`${formatNegativeMemorySection(failedApproaches, s)}\n`);
  }

  // Section 7: Environment Staleness Analysis
  if (stalenessReport && (record.status === 'RECOVERED' || record.status === 'VERIFIED')) {
    if (stalenessReport.isStale) {
      stdout.write(`${s.bold(s.yellow('ENVIRONMENT STALENESS ANALYSIS:'))}\n`);
      stdout.write(`  ${s.yellow('[STALE EVIDENCE]')} The environment has diverged since this recovery was verified:\n`);
      for (const reason of stalenessReport.reasons) {
        stdout.write(`    • ${s.dim(reason)}\n`);
      }
      stdout.write('\n');
    } else {
      stdout.write(`${s.bold(s.green('ENVIRONMENT COMPATIBILITY:'))}\n`);
      stdout.write(`  ${s.green('✔ Compatible')} Current runtime environment matches verified recovery conditions.\n\n`);
    }
  }

  // Section 8: Evidence Conflicts & Contradictions
  if (conflictReport && conflictReport.hasConflicts) {
    stdout.write(`${formatContradictionSection(conflictReport, s)}\n`);
  }

  stdout.write(`${divider}\n\n`);
  return 0;
}

