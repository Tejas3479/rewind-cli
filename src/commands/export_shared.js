import { exportRecoveryBundle } from '../sharing/bundle.js';
import { formatJson, formatBox } from '../formatter.js';

/**
 * Handler for `rewind export-shared [options]`.
 * Exports verified recovery knowledge from the local ledger into a sanitized, portable bundle.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function exportSharedCommand({ context }) {
  const { parsedArgs, storage, config, stdout, styler } = context;
  const s = styler;
  const isJson = Boolean(parsedArgs.flags.json);

  const rootDir = config.rootDir || process.cwd();
  const outputPath = parsedArgs.flags.output || null;
  const includeUnverified = Boolean(parsedArgs.flags.includeUnverified);

  const result = exportRecoveryBundle({
    storage,
    rootDir,
    outputPath,
    includeUnverified
  });

  if (isJson) {
    stdout.write(formatJson({
      status: 'success',
      outputPath: result.outputPath,
      totalIncidents: result.totalIncidents,
      totalVerifiedRecoveries: result.totalVerifiedRecoveries,
      bundleFingerprint: result.bundle.bundleFingerprint
    }) + '\n');
    return 0;
  }

  const box = formatBox('SHARED RECOVERY BUNDLE EXPORTED', [
    { label: 'Bundle Destination', value: result.outputPath },
    { label: 'Exported Incidents', value: String(result.totalIncidents) },
    { label: 'Verified Recoveries', value: String(result.totalVerifiedRecoveries) },
    { label: 'Bundle Fingerprint', value: result.bundle.bundleFingerprint.slice(0, 16) + '...' },
    { label: 'Unverified Included', value: includeUnverified ? 'Yes (--include-unverified)' : 'No (Verified only)' }
  ], s, 'success');

  stdout.write('\n' + box + '\n\n');
  stdout.write(`${s.bold('Sharing Instructions:')}\n`);
  stdout.write(`  Commit and share this bundle artifact with your team:\n`);
  stdout.write(`  ${s.cyan(`git add ${result.outputPath}`)}\n\n`);
  stdout.write(`  Teammates can import this bundle via:\n`);
  stdout.write(`  ${s.cyan(`rewind import-shared ${result.outputPath}`)}\n\n`);

  return 0;
}
