import { formatJson } from '../formatter.js';
import { runDoctorDiagnostics, executeDoctorRepair } from '../storage/doctor.js';

/**
 * Formats a badge for a check status.
 *
 * @param {'PASS'|'WARN'|'FAIL'|'BLOCKED'|'INFO'} status
 * @param {import('../formatter.js').createStyler} s
 * @returns {string}
 */
function formatStatusTag(status, s) {
  switch (status) {
    case 'PASS':
      return s.green(s.bold('PASS   '));
    case 'WARN':
      return s.yellow(s.bold('WARN   '));
    case 'FAIL':
      return s.red(s.bold('FAIL   '));
    case 'BLOCKED':
      return s.red(s.bold('BLOCKED'));
    case 'INFO':
    default:
      return s.cyan(s.bold('INFO   '));
  }
}

/**
 * Handler for `rewind doctor [--repair] [--dry-run] [--json] [options]`.
 * Evaluates local installation health, ledger integrity, storage consistency,
 * and executes safe non-destructive repairs when requested.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>} Exit code (0 for healthy/repaired, 1 for errors/corruption)
 */
export async function doctorCommand({ context }) {
  const { parsedArgs, config, stdout, stderr, styler } = context;
  const isJsonMode = Boolean(parsedArgs.flags.json);
  const isRepairMode = Boolean(parsedArgs.flags.repair);
  const isDryRun = Boolean(parsedArgs.flags.dryRun);
  const s = styler;

  const termWidth = (stdout && typeof stdout.columns === 'number' && stdout.columns > 20)
    ? Math.min(stdout.columns, 80)
    : 72;
  const divider = s.dim('─'.repeat(termWidth));

  // ==========================================
  // Repair Execution Path (--repair)
  // ==========================================
  if (isRepairMode) {
    const repairResult = executeDoctorRepair(config.ledgerDir, config, { dryRun: isDryRun });

    if (isJsonMode) {
      stdout.write(formatJson({
        status: repairResult.status,
        dryRun: repairResult.dryRun,
        plannedActions: repairResult.plannedActions || [],
        actionsTaken: repairResult.actionsTaken || [],
        preserved: repairResult.preserved || [],
        postRepairIntegrity: repairResult.postRepairIntegrity || 'UNKNOWN',
        diagnostics: repairResult.diagnostics
      }) + '\n');
      return ['REFUSED', 'FAILED', 'ERROR'].includes(repairResult.status) ? 1 : 0;
    }

    const title = isDryRun
      ? s.yellow(s.bold('REWIND DOCTOR REPAIR (DRY-RUN)'))
      : s.bold('REWIND DOCTOR REPAIR');

    stdout.write(`\n${title}\n`);
    stdout.write(`${divider}\n`);

    if (repairResult.status === 'REFUSED') {
      stdout.write(`  ${s.red(s.bold('REPAIR REFUSED'))}\n`);
      stdout.write(`  ${s.dim('Reason:'.padEnd(16))} ${s.red(repairResult.reason)}\n`);
      stdout.write(`${divider}\n`);
      stdout.write(`${s.dim('Authoritative journal integrity must be audited manually with "rewind verify-integrity".')}\n\n`);
      return 1;
    }

    if (repairResult.status === 'NOOP') {
      stdout.write(`  ${s.green(s.bold('NO REPAIR REQUIRED'))}\n`);
      stdout.write(`  ${s.dim('Status:'.padEnd(16))} ${repairResult.message}\n`);
      stdout.write(`${divider}\n\n`);
      return 0;
    }

    if (isDryRun) {
      stdout.write(`  ${s.bold('PLANNED ACTIONS (Dry-Run Only — No disk modifications):')}\n`);
      for (const act of repairResult.plannedActions) {
        stdout.write(`    ${s.yellow('•')} ${act}\n`);
      }
      stdout.write('\n');
      stdout.write(`  ${s.bold('WOULD NOT TOUCH (Immutable Guarantees):')}\n`);
      for (const p of repairResult.preserved) {
        stdout.write(`    ${s.green('✔')} ${p}\n`);
      }
      stdout.write(`${divider}\n`);
      stdout.write(`Run "${s.cyan('rewind doctor --repair')}" without --dry-run to apply safe maintenance.\n\n`);
      return 0;
    }

    // Completed Repair
    stdout.write(`  ${s.bold('ACTIONS EXECUTED:')}\n`);
    for (const act of repairResult.actionsTaken) {
      stdout.write(`    ${s.green('✔')} ${act}\n`);
    }
    stdout.write('\n');
    stdout.write(`  ${s.bold('PRESERVED INVARIANTS:')}\n`);
    for (const p of repairResult.preserved) {
      stdout.write(`    ${s.green('✔')} ${p}\n`);
    }
    stdout.write('\n');
    stdout.write(`  ${s.dim('Post-Repair Integrity:'.padEnd(26))} ${repairResult.postRepairIntegrity === 'PASS' ? s.green('✔ TRUSTED') : s.yellow(repairResult.postRepairIntegrity)}\n`);
    stdout.write(`${divider}\n`);
    stdout.write(`${s.green('Safe repair complete. Derived projections and temporary directories synchronized.')}\n\n`);
    return 0;
  }

  // ==========================================
  // Standard Diagnostics Path (rewind doctor)
  // ==========================================
  const report = runDoctorDiagnostics(config.ledgerDir, config);

  if (isJsonMode) {
    stdout.write(formatJson({
      status: report.status,
      summary: report.summary,
      healthChecks: report.healthChecks,
      metrics: report.metrics,
      warnings: report.warnings,
      errors: report.errors,
      repair: report.repair
    }) + '\n');
    return report.status === 'CORRUPTED' || report.status === 'BLOCKED' ? 1 : 0;
  }

  const statusBadge = report.status === 'HEALTHY'
    ? s.green(s.bold('[HEALTHY]'))
    : (report.status === 'WARNING'
        ? s.yellow(s.bold('[WARNING]'))
        : s.red(s.bold(`[${report.status}]`)));

  stdout.write(`\n${s.bold('REWIND DOCTOR')}  ${statusBadge}\n`);
  stdout.write(`${divider}\n`);

  // Section 1: Health Checks
  stdout.write(`${s.bold('SYSTEM & LEDGER HEALTH CHECKS:')}\n`);
  for (const check of report.healthChecks) {
    const tag = formatStatusTag(check.status, s);
    stdout.write(`  ${tag}  ${check.name.padEnd(36)} ${s.dim(check.message)}\n`);
  }
  stdout.write('\n');

  // Section 2: Informational Metrics
  stdout.write(`${s.bold('INFORMATIONAL METRICS:')}\n`);
  const m = report.metrics;
  stdout.write(`  ${s.cyan(s.bold('INFO   '))}  ${'Disk usage:'.padEnd(36)} ${s.bold(m.diskUsageFormatted)}\n`);
  stdout.write(`  ${s.cyan(s.bold('INFO   '))}  ${'Total incident records:'.padEnd(36)} ${s.bold(String(m.totalRecords))}\n`);
  stdout.write(`  ${s.cyan(s.bold('INFO   '))}  ${'Verified recoveries:'.padEnd(36)} ${s.green(s.bold(String(m.verifiedRecoveries)))}\n`);
  stdout.write(`  ${s.cyan(s.bold('INFO   '))}  ${'Recorded regressions:'.padEnd(36)} ${m.regressions > 0 ? s.red(s.bold(String(m.regressions))) : s.dim('0')}\n`);
  stdout.write(`  ${s.cyan(s.bold('INFO   '))}  ${'Authoritative journal events:'.padEnd(36)} ${s.bold(String(m.journalEventsCount))}\n`);
  stdout.write('\n');

  // Section 3: Warnings
  if (report.warnings.length > 0) {
    stdout.write(`${s.bold(s.yellow('WARNINGS:'))}\n`);
    for (const w of report.warnings) {
      stdout.write(`  ${s.yellow('⚠')} ${w}\n`);
    }
    stdout.write('\n');
  }

  // Section 4: Errors
  if (report.errors.length > 0) {
    stdout.write(`${s.bold(s.red('FAILURES & INTEGRITY VIOLATIONS:'))}\n`);
    for (const e of report.errors) {
      stdout.write(`  ${s.red('✗')} ${e}\n`);
    }
    stdout.write('\n');
  }

  // Section 5: Summary & Action
  stdout.write(`${divider}\n`);
  stdout.write(`  ${s.bold('SUMMARY:')} ${s.green(`${report.summary.passed} passed`)}, ${s.yellow(`${report.summary.warnings} warning(s)`)}, ${report.summary.failures > 0 ? s.red(`${report.summary.failures} failure(s)`) : s.dim('0 failures')}\n`);

  if (report.repair.recommended) {
    stdout.write(`\n  ${s.bold('ACTION:')}\n`);
    stdout.write(`    Safe non-destructive maintenance is available.\n`);
    stdout.write(`    Run: ${s.cyan('rewind doctor --repair')}\n`);
    stdout.write(`    Or preview changes with: ${s.cyan('rewind doctor --repair --dry-run')}\n`);
  } else if (report.repair.blocked) {
    stdout.write(`\n  ${s.bold('ACTION:')}\n`);
    stdout.write(`    ${s.red(`Repair blocked: ${report.repair.blockReason}`)}\n`);
    stdout.write(`    Run ${s.cyan('rewind verify-integrity')} for complete cryptographic audit details.\n`);
  }
  stdout.write('\n');

  return report.status === 'CORRUPTED' || report.status === 'BLOCKED' ? 1 : 0;
}
