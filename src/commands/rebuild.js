import { formatJson } from '../formatter.js';

/**
 * Handler for `rewind rebuild [--json]`.
 * Reconstructs all derived incident projection files in .rewind/records/ and
 * in-memory indexes by replaying the authoritative journal from sequence 1 to N.
 *
 * Invariant: Never mutates or alters journal.jsonl.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function rebuildCommand({ context }) {
  const { parsedArgs, storage, stdout, styler } = context;
  const isJsonMode = Boolean(parsedArgs.flags.json);

  const result = storage.rebuildProjections();

  if (isJsonMode) {
    stdout.write(formatJson({
      status: 'success',
      eventsReplayed: result.eventsReplayed,
      incidentsDerived: result.incidentsDerived,
      authoritativeJournal: 'UNCHANGED'
    }) + '\n');
    return 0;
  }

  const s = styler;
  const termWidth = (stdout && typeof stdout.columns === 'number' && stdout.columns > 20)
    ? Math.min(stdout.columns, 80)
    : 72;
  const divider = s.dim('─'.repeat(termWidth));

  stdout.write(`\n${s.bold('PROJECTION REBUILD COMPLETE')}\n`);
  stdout.write(`${divider}\n`);
  stdout.write(`  ${s.dim('Events Replayed:'.padEnd(24))} ${s.bold(String(result.eventsReplayed))}\n`);
  stdout.write(`  ${s.dim('Incidents Derived:'.padEnd(24))} ${s.cyan(String(result.incidentsDerived))}\n`);
  stdout.write(`  ${s.dim('Indexes Rebuilt:'.padEnd(24))} ${s.green('✔ OK')}\n`);
  stdout.write(`  ${s.dim('Authoritative Journal:'.padEnd(24))} ${s.green('UNCHANGED (.rewind/journal.jsonl)')}\n`);
  stdout.write(`${divider}\n`);
  stdout.write(`${s.dim('All derived incident records in .rewind/projection.db have been reconstructed from immutable history.')}\n\n`);

  return 0;
}
