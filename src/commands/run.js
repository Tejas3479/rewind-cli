import { MissingArgumentError } from '../errors.js';
import { executeAndCapture } from '../capture.js';
import { hasShellOperators } from '../parser.js';
import { formatJson } from '../formatter.js';
import { IncidentStatus } from '../storage/state.js';
import { sanitizeForDisplay } from '../sanitizer.js';
import { formatNegativeMemorySection } from '../storage/negative_memory.js';
import { formatContradictionSection } from '../storage/contradiction.js';

/**
 * Handler for `rewind run <command...>`.
 * Executes the user-requested process, streams output live, captures all diagnostic
 * lifecycle evidence, persists failure records into local storage, detects regressions,
 * surfaces verified fixes, known failed approaches, and staleness warnings,
 * and strictly propagates the child process's exit code.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>} - Child process exit code
 */
export async function runCommand({ context }) {
  const { parsedArgs, config, storage, env, stdout, stderr, styler } = context;
  const targetCommand = parsedArgs.positional;

  if (!targetCommand || targetCommand.length === 0) {
    throw new MissingArgumentError('command', 'rewind run <command...>');
  }

  const isJsonMode = Boolean(parsedArgs.flags.json);

  // If in JSON mode, avoid multiplexing live stream to stdout to preserve pure JSON output
  const stdoutStream = isJsonMode ? null : stdout;
  const stderrStream = isJsonMode ? null : stderr;

  const isShellCommand = Boolean(parsedArgs.flags.shell) ||
    (targetCommand.length === 1 && hasShellOperators(targetCommand[0])) ||
    targetCommand.some(token => ['&&', '||', ';', '|', '&', '>', '<'].includes(token));

  const result = await executeAndCapture(targetCommand, {
    cwd: config.rootDir,
    env,
    stdoutStream,
    stderrStream,
    shell: isShellCommand
  });

  let savedRecord = null;
  // Automatically persist failure records in local ledger
  if (!result.success && storage) {
    try {
      savedRecord = storage.saveRecord(result);

      if (!isJsonMode && stderr && typeof stderr.write === 'function') {
        const s = styler;
        const idText = s.bold(`#${savedRecord.id}`);

        if (savedRecord.status === IncidentStatus.REGRESSED && savedRecord.regressionOf) {
          const prior = storage.getRecord(savedRecord.regressionOf);
          let verifiedAttempt = null;

          if (prior && Array.isArray(prior.recoveryAttempts)) {
            for (let i = prior.recoveryAttempts.length - 1; i >= 0; i--) {
              if (prior.recoveryAttempts[i].status === 'VERIFIED') {
                verifiedAttempt = prior.recoveryAttempts[i];
                break;
              }
            }
          }

          if (verifiedAttempt) {
            const alertTitle = s.red(s.bold('[rewind:REGRESSION]'));
            stderr.write(`\n${alertTitle} Failure matches previously ${s.green('VERIFIED')} Incident #${savedRecord.regressionOf}\n\n`);
            stderr.write(`${s.bold('HISTORICAL VERIFIED RECOVERY (Exact Match):')}\n`);
            if (verifiedAttempt.cause) stderr.write(`  ${s.dim('Suspected Cause:'.padEnd(20))} ${sanitizeForDisplay(verifiedAttempt.cause)}\n`);
            if (verifiedAttempt.change) stderr.write(`  ${s.dim('Verified Fix:'.padEnd(20))} ${sanitizeForDisplay(verifiedAttempt.change)}\n`);
            if (verifiedAttempt.verifyCmd) stderr.write(`  ${s.dim('Verify Command:'.padEnd(20))} ${s.cyan(sanitizeForDisplay(verifiedAttempt.verifyCmd))}\n`);
            stderr.write('\n');
          }

          // Staleness Evaluation
          const staleness = storage.getStalenessReport(savedRecord.regressionOf);
          if (staleness && staleness.isStale) {
            stderr.write(`${s.bold(s.yellow('[STALENESS WARNING]'))} ${s.dim('Historical environment context has changed since verification:')}\n`);
            for (const reason of staleness.reasons) {
              stderr.write(`  ${s.yellow('•')} ${s.dim(reason)}\n`);
            }
            stderr.write('\n');
          }

          // Negative Memory (Known Failed Approaches)
          const failedApproaches = storage.getNegativeMemory(savedRecord.fingerprint);
          if (failedApproaches.length > 0) {
            stderr.write(`${formatNegativeMemorySection(failedApproaches, s)}\n`);
          }

          // Contradiction Analysis
          const conflicts = storage.getContradictionReport(savedRecord.fingerprint);
          if (conflicts.hasConflicts) {
            stderr.write(`${formatContradictionSection(conflicts, s)}\n`);
          }

          stderr.write(`Recorded recurring failure as Incident ${idText} (Status: ${s.red('REGRESSED')}). Run "${s.cyan(`rewind show ${savedRecord.id}`)}".\n`);
          stderr.write(`${s.dim('Important: Historical recovery is evidence, not an automatic fix. Rewind never automatically replays past commands.')}\n\n`);
        } else {
          const tag = s.badge('rewind', s.yellow);
          stderr.write(`\n${tag} Recorded failure as incident ${idText}. Run "${s.cyan(`rewind show ${savedRecord.id}`)}" to inspect.\n\n`);
        }
      }
    } catch (storageErr) {
      if (!isJsonMode && stderr && typeof stderr.write === 'function') {
        stderr.write(`\n[rewind:warning] Failed to persist incident record: ${storageErr.message}\n\n`);
      }
    }
  }

  if (isJsonMode) {
    stdout.write(formatJson({
      status: result.success ? 'success' : 'failure',
      incidentId: savedRecord ? savedRecord.id : null,
      data: savedRecord || result
    }) + '\n');
  }

  // Propagate exact child exit code
  return typeof result.exitCode === 'number' ? result.exitCode : (result.success ? 0 : 1);
}

