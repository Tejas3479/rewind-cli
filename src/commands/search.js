import { MissingArgumentError } from '../errors.js';
import { searchRecords } from '../storage/search.js';
import { formatJson } from '../formatter.js';
import { sanitizeForDisplay } from '../sanitizer.js';
import { captureSafeEnvironment } from '../environment.js';
import { readGitMetadata } from '../git.js';

/**
 * Returns formatted colored confidence badge.
 *
 * @param {string} confidence
 * @param {'EXACT_MATCH'|'SIMILAR_MATCH'} matchType
 * @param {import('../formatter.js').createStyler} s
 * @returns {string}
 */
function formatConfidenceBadge(confidence, matchType, s) {
  if (matchType === 'EXACT_MATCH') {
    return confidence === 'VERIFIED'
      ? s.green(s.bold('[EXACT MATCH: VERIFIED RECOVERY]'))
      : s.cyan(s.bold('[EXACT MATCH: UNVERIFIED]'));
  }

  switch (confidence) {
    case 'VERIFIED':
      return s.green(s.bold('[SIMILAR: VERIFIED RECOVERY]'));
    case 'LIKELY':
      return s.cyan(s.bold('[SIMILAR: LIKELY PATTERN]'));
    case 'NOT PROVEN':
    default:
      return s.dim('[SIMILAR: NOT PROVEN]');
  }
}

/**
 * Handler for `rewind search <query...> [options]`.
 * Deterministically searches historical failures using token overlap and fingerprint matching.
 * All terminal display output is sanitized to prevent ANSI injection and secret leakage.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function searchCommand({ context }) {
  const { parsedArgs, storage, stdout, styler } = context;
  const queryTokens = parsedArgs.positional;

  if (!queryTokens || queryTokens.length === 0) {
    throw new MissingArgumentError('query', 'rewind search <query...> [--limit N] [--json]');
  }

  const query = queryTokens.join(' ');
  const { records: allRecords } = storage.listRecords();
  
  let limit = parsedArgs.flags.limit;
  if (limit === undefined) {
    limit = context.config.settings?.defaultLimit ?? 20;
  } else if (limit === 0) {
    limit = undefined;
  }

  const matches = searchRecords(query, allRecords, { limit });

  if (parsedArgs.flags.json) {
    stdout.write(formatJson({
      status: 'success',
      query,
      count: matches.length,
      data: matches
    }) + '\n');
    return 0;
  }

  const s = styler;
  const termWidth = (stdout && typeof stdout.columns === 'number' && stdout.columns > 20)
    ? Math.min(stdout.columns, 80)
    : 80;
  const divider = s.dim('─'.repeat(termWidth));

  if (matches.length === 0) {
    const tag = s.badge('rewind:search', s.yellow);
    stdout.write(`\n${tag} No matching failure records found for query: "${sanitizeForDisplay(query)}"\n`);
    stdout.write(`Run "${s.cyan('rewind history')}" to browse all past incidents.\n\n`);
    return 0;
  }

  const safeEnv = captureSafeEnvironment(context.env || process.env);
  const safeGit = readGitMetadata(process.cwd());

  stdout.write(`\n${s.bold(`SEARCH RESULTS for "${sanitizeForDisplay(query)}"`)} ${s.dim(`(${matches.length} candidate(s))`)}\n`);
  stdout.write(`${divider}\n`);

  for (const match of matches) {
    const rec = match.record;
    const scorePct = `${Math.round(match.score * 100)}%`;
    const confBadge = formatConfidenceBadge(match.confidence, match.matchType, s);
    const idBadge = s.bold(`#${match.id}`);
    const fpBadge = s.dim(`[fp: ${rec.fingerprint ? rec.fingerprint.slice(0, 8) : 'none'}]`);

    stdout.write(`\n${confBadge} Incident ${idBadge} ${fpBadge} — Similarity: ${s.bold(scorePct)}\n`);
    stdout.write(`  ${s.dim('Status:'.padEnd(16))} ${rec.status}\n`);
    stdout.write(`  ${s.dim('Command:'.padEnd(16))} ${sanitizeForDisplay(rec.fullCommand || rec.command)}\n`);
    stdout.write(`  ${s.dim('Match Reason:'.padEnd(16))} ${s.yellow(sanitizeForDisplay(match.reason))}\n`);

    // Surface historical recovery evidence
    const attempts = Array.isArray(rec.recoveryAttempts) ? rec.recoveryAttempts : [];
    const verifiedAttempt = attempts.find(a => a.status === 'VERIFIED') || (attempts.length > 0 ? attempts[attempts.length - 1] : null);

    if (verifiedAttempt) {
      if (verifiedAttempt.cause) stdout.write(`  ${s.dim('Suspected Cause:'.padEnd(18))} ${sanitizeForDisplay(verifiedAttempt.cause)}\n`);
      if (verifiedAttempt.change) stdout.write(`  ${s.dim('Remediation Fix:'.padEnd(18))} ${sanitizeForDisplay(verifiedAttempt.change)}\n`);
      if (verifiedAttempt.verifyCmd) stdout.write(`  ${s.dim('Verify Command:'.padEnd(18))} ${s.cyan(sanitizeForDisplay(verifiedAttempt.verifyCmd))}\n`);
    }

    if (match.failedAttemptsCount > 0) {
      stdout.write(`  ${s.dim('Negative Memory:'.padEnd(18))} ${s.yellow(`${match.failedAttemptsCount} failed approach(es) on record (see show ${match.id})`)}\n`);
    }

    const staleness = storage.getStalenessReport(rec.id, safeEnv, safeGit);
    if (staleness && staleness.isStale) {
      stdout.write(`  ${s.dim('Context Warning:'.padEnd(18))} ${s.yellow('[STALE EVIDENCE — Environment has diverged since verification]')}\n`);
    }

    const isRecovered = rec.status === 'RECOVERED' || rec.status === 'VERIFIED';
    if (isRecovered && rec.verification) {
      stdout.write(`  ${s.green('✔ Verified under recorded conditions')}\n`);
    }
  }

  stdout.write(`\n${divider}\n`);
  stdout.write(`${s.dim('Note: Similarity retrieves evidence. Verification establishes truth.')}\n`);
  stdout.write(`${s.dim(`Showing top ${matches.length} candidate(s). Run "${s.cyan('rewind show <id>')}" for complete forensic evidence.`)}\n\n`);

  return 0;
}

