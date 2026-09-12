import { formatJson, formatRelativeTime, formatStatusBadge, visibleLength } from '../formatter.js';
import { RecoveryStates } from '../storage/state.js';
import { sanitizeForDisplay } from '../sanitizer.js';

/**
 * Derives a concise result summary for an incident row.
 *
 * @param {import('../storage/record.js').IncidentRecord} rec
 * @param {import('../formatter.js').createStyler} s
 * @returns {string}
 */
function getResultSummary(rec, s) {
  if (rec.status === 'RECOVERED' || rec.status === 'VERIFIED') {
    return s.green('verified fix');
  }
  if (rec.status === 'REGRESSED') {
    return rec.regressionOf ? s.red(`matches #${rec.regressionOf}`) : s.red('regressed');
  }
  if (rec.status === 'OPEN' || rec.status === 'FIXED') {
    const attempts = Array.isArray(rec.recoveryAttempts) ? rec.recoveryAttempts.length : 0;
    return s.cyan(attempts > 0 ? `${attempts} attempt(s)` : 'open');
  }
  if (rec.status === 'RESOLVED') {
    return s.blue('resolved');
  }
  if (rec.status === 'SUSPECTED') {
    return s.yellow('suspected');
  }
  if (rec.exitCode !== null && rec.exitCode !== undefined) {
    return s.dim(`exit ${rec.exitCode}`);
  }
  return s.dim('failed');
}

/**
 * Handler for `rewind history [options]`.
 * Lists historical failure incidents sorted newest first, with support for --limit and --json.
 * Uses adaptive column layout based on terminal width without external packages.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function historyCommand({ context }) {
  const { parsedArgs, storage, stdout, styler } = context;

  // Use CLI flag if provided, otherwise config default. If explicit 0 is passed, fetch all.
  let limit = parsedArgs.flags.limit;
  if (limit === undefined) {
    limit = context.config.settings?.defaultLimit ?? 20;
  } else if (limit === 0) {
    limit = undefined; // 0 means all
  }
  const offset = parsedArgs.flags.offset || 0;
  const { records, total: totalCount } = storage.listRecords({ limit, offset, reverse: true });

  if (parsedArgs.flags.json) {
    stdout.write(formatJson({
      status: 'success',
      total: totalCount,
      count: records.length,
      data: records
    }) + '\n');
    return 0;
  }

  const s = styler;

  if (records.length === 0) {
    const tag = s.badge('rewind', s.yellow);
    stdout.write(`\n${tag} No recorded incidents in ledger.\n`);
    stdout.write(`Run "${s.cyan('rewind run <command...>')}" to start capturing failures.\n\n`);
    return 0;
  }

  const termWidth = (stdout && typeof stdout.columns === 'number' && stdout.columns > 20)
    ? stdout.columns
    : 80;

  // Responsive column widths
  const isNarrow = termWidth < 70;
  const colIdWidth = 6;
  const colStatusWidth = isNarrow ? 11 : 12;
  const colTimeWidth = isNarrow ? 9 : 11;
  const colResultWidth = isNarrow ? 12 : 14;
  const gutter = '  ';
  const fixedWidth = colIdWidth + colStatusWidth + colTimeWidth + colResultWidth + (4 * gutter.length);
  const colCmdWidth = Math.max(16, Math.min(50, termWidth - fixedWidth));

  const totalLineWidth = colIdWidth + colStatusWidth + colCmdWidth + colTimeWidth + colResultWidth + (4 * gutter.length);
  const dividerLen = Math.min(termWidth, Math.max(50, totalLineWidth));
  const divider = s.dim('─'.repeat(dividerLen));

  stdout.write(`\n${s.bold('REWIND RECOVERY LEDGER')} ${s.dim(`(${totalCount} total incidents)`)}\n`);
  stdout.write(`${divider}\n`);

  // Header
  const hId = 'ID'.padEnd(colIdWidth);
  const hStatus = 'STATUS'.padEnd(colStatusWidth);
  const hCmd = 'COMMAND'.padEnd(colCmdWidth);
  const hTime = 'TIME'.padEnd(colTimeWidth);
  const hResult = 'RESULT';

  stdout.write(`${s.dim(hId)}${gutter}${s.dim(hStatus)}${gutter}${s.dim(hCmd)}${gutter}${s.dim(hTime)}${gutter}${s.dim(hResult)}\n`);
  stdout.write(`${divider}\n`);

  for (const rec of records) {
    const idText = `#${rec.id}`.padEnd(colIdWidth);
    const rawCmd = sanitizeForDisplay(rec.fullCommand || `${rec.command} ${(rec.args || []).join(' ')}`.trim());
    const cmdTruncated = rawCmd.length > colCmdWidth
      ? rawCmd.slice(0, colCmdWidth - 3) + '...'
      : rawCmd.padEnd(colCmdWidth);

    const relTime = formatRelativeTime(rec.startTime).padEnd(colTimeWidth);
    const badge = formatStatusBadge(rec.status, s);
    const badgeVisLen = visibleLength(badge);
    const statusPadding = ' '.repeat(Math.max(0, colStatusWidth - badgeVisLen));
    const resultSummary = getResultSummary(rec, s);

    stdout.write(`${s.bold(idText)}${gutter}${badge}${statusPadding}${gutter}${cmdTruncated}${gutter}${s.dim(relTime)}${gutter}${resultSummary}\n`);
  }

  stdout.write(`${divider}\n`);

  const startIdx = offset + 1;
  const endIdx = offset + records.length;
  stdout.write(`${s.dim(`Showing ${startIdx}-${endIdx} of ${totalCount} incidents.`)}\n`);
  
  if (endIdx < totalCount) {
    const nextLimit = limit || records.length;
    stdout.write(`${s.dim(`Next: rewind history --limit ${nextLimit} --offset ${endIdx}`)}\n`);
  }
  
  stdout.write(`${s.dim(`Run "${s.cyan('rewind show <id>')}" to inspect full forensic details.`)}\n\n`);

  return 0;
}
