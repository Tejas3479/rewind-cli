import path from 'node:path';
import { importRecoveryBundle, DEFAULT_SHARED_BUNDLE_FILENAME } from '../sharing/bundle.js';
import { formatJson, formatBox } from '../formatter.js';

/**
 * Handler for `rewind import-shared <file> [options]`.
 * Imports recovery records from a shared bundle into the local ledger as external evidence.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function importSharedCommand({ context }) {
  const { parsedArgs, storage, config, stdout, styler } = context;
  const s = styler;
  const isJson = Boolean(parsedArgs.flags.json);
  const dryRun = Boolean(parsedArgs.flags.dryRun);
  const overwrite = Boolean(parsedArgs.flags.overwrite);

  const rootDir = config.rootDir || process.cwd();
  let targetFile = parsedArgs.positional[0] || parsedArgs.flags.output || null;

  if (!targetFile) {
    const defaultCandidate = path.join(rootDir, DEFAULT_SHARED_BUNDLE_FILENAME);
    targetFile = defaultCandidate;
  }

  const result = importRecoveryBundle({
    storage,
    bundle: targetFile,
    rootDir,
    dryRun,
    overwrite
  });

  if (isJson) {
    stdout.write(formatJson({
      status: 'success',
      bundleFile: targetFile,
      dryRun,
      importedCount: result.importedCount,
      skippedCount: result.skippedCount,
      totalVerifiedRecoveries: result.totalVerifiedRecoveries,
      incidents: result.importedIncidents.map(inc => ({
        id: inc.id,
        fingerprint: inc.fingerprint,
        command: inc.command,
        recoveryAttempts: (inc.recoveryAttempts || []).map(a => ({
          id: a.id,
          cause: a.cause,
          change: a.change,
          verifyCmd: a.verifyCmd,
          status: a.status,
          isExternal: a.isExternal
        }))
      }))
    }) + '\n');
    return 0;
  }

  const title = dryRun ? 'SHARED RECOVERY BUNDLE PREVIEW (DRY-RUN)' : 'SHARED RECOVERY BUNDLE IMPORTED';
  const box = formatBox(title, [
    { label: 'Bundle Source', value: targetFile },
    { label: 'Imported Incidents', value: String(result.importedCount) },
    { label: 'External Verified Fixes', value: String(result.totalVerifiedRecoveries) },
    { label: 'Skipped (Duplicates)', value: String(result.skippedCount) },
    { label: 'Trust Status', value: 'EXTERNAL EVIDENCE (Unverified Locally)' }
  ], s, dryRun ? 'warning' : 'success');

  stdout.write('\n' + box + '\n\n');

  if (result.importedCount > 0) {
    stdout.write(`${s.bold('Imported Incident References:')}\n`);
    for (const inc of result.importedIncidents) {
      const idStr = s.bold(`#${inc.id}`);
      const attemptsCount = Array.isArray(inc.recoveryAttempts) ? inc.recoveryAttempts.length : 0;
      stdout.write(`  • Incident ${idStr}: ${s.cyan(inc.fullCommand || inc.command)} ${s.dim(`(${attemptsCount} recovery attempt(s))`)}\n`);
    }
    stdout.write('\n');
    stdout.write(`${s.bold('Next Steps for Local Verification:')}\n`);
    stdout.write(`  Imported recoveries are marked ${s.cyan('VERIFIED — EXTERNAL EVIDENCE')}.\n`);
    stdout.write(`  To verify and seal an imported recovery locally on this machine, run:\n`);
    const firstId = result.importedIncidents[0]?.id || '1';
    stdout.write(`  ${s.cyan(`rewind verify ${firstId}`)}\n\n`);
  } else if (result.skippedCount > 0) {
    stdout.write(`${s.dim('All incidents in the bundle were already recorded in the local ledger.')}\n\n`);
  }

  return 0;
}
