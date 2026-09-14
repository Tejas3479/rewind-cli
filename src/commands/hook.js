import { InvalidArgumentError } from '../errors.js';
import {
  SUPPORTED_SHELLS,
  normalizeShellName,
  getBashHook,
  getZshHook,
  getFishHook,
  getPowerShellHook,
  getInstallationOverview
} from '../hooks/templates.js';
import { tokenizeCommandLine } from '../parser.js';
import { redactSecrets, sanitizeForDisplay } from '../sanitizer.js';
import { captureSafeEnvironment } from '../environment.js';
import { readGitMetadata } from '../git.js';
import { parseDiagnostic } from '../diagnostics/index.js';
import { IncidentStatus } from '../storage/state.js';

/**
 * Handler for `rewind hook [shell|record] [options]`.
 * Generates shell-specific integration scripts or passively records failed commands
 * reported by active shell hooks.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function hookCommand({ context }) {
  const { parsedArgs, storage, config, env, stdout, stderr, styler } = context;
  const s = styler;
  const target = (parsedArgs.flags?.shell || parsedArgs.positional[0] || '').trim().toLowerCase();

  // If invoked as record helper by active shell hooks
  if (target === 'record' || parsedArgs.flags.exit !== null || parsedArgs.flags.cmd !== null) {
    const exitCode = typeof parsedArgs.flags.exit === 'number'
      ? parsedArgs.flags.exit
      : (parsedArgs.flags.exit ? Number.parseInt(parsedArgs.flags.exit, 10) : null);

    const rawCmd = parsedArgs.flags.cmd || parsedArgs.positional.slice(1).join(' ');

    // Only record non-zero failures with non-empty command
    if (exitCode === null || exitCode === 0 || !rawCmd || !rawCmd.trim()) {
      return 0;
    }

    try {
      const cwd = parsedArgs.flags.cwd || config.rootDir || process.cwd();
      const tokens = tokenizeCommandLine(rawCmd.trim());
      const executable = tokens[0] || rawCmd.trim();
      const args = tokens.slice(1);

      // Apply strict privacy and secret redaction
      const fullCommandSanitized = redactSecrets(rawCmd.trim());
      const argsSanitized = args.map(a => redactSecrets(a));
      const rawStderr = parsedArgs.flags.stderr || '';
      const stderrSanitized = sanitizeForDisplay(rawStderr);

      // Safe environment and Git metadata
      const safeEnv = captureSafeEnvironment(env || process.env);
      const gitMetadata = readGitMetadata(cwd);

      // Diagnostic parsing
      const diagnostic = parseDiagnostic(stderrSanitized || rawStderr, '', { command: executable, cwd });

      const nowIso = new Date().toISOString();
      const durationMs = typeof parsedArgs.flags.duration === 'number' && parsedArgs.flags.duration >= 0
        ? parsedArgs.flags.duration
        : 0;
      const startTimeIso = new Date(Date.now() - durationMs).toISOString();

      /** @type {import('../capture.js').CaptureRecord} */
      const record = {
        command: executable,
        args: argsSanitized,
        fullCommand: fullCommandSanitized,
        cwd,
        startTime: startTimeIso,
        endTime: nowIso,
        durationMs,
        exitCode,
        signal: null,
        timedOut: false,
        success: false,
        stdoutRaw: '',
        stderrRaw: rawStderr,
        stdout: '',
        stderr: stderrSanitized,
        diagnostic,
        isTruncated: false,
        git: gitMetadata,
        environment: safeEnv
      };

      if (storage) {
        const savedRecord = storage.saveRecord(record);

        if (stderr && typeof stderr.write === 'function') {
          const tag = s.badge('rewind', s.yellow);
          const idText = s.bold(`#${savedRecord.id}`);

          if (savedRecord.status === IncidentStatus.REGRESSED && savedRecord.regressionOf) {
            stderr.write(`\n${tag} Failure recorded as incident ${idText} ${s.red('(REGRESSION of verified #' + savedRecord.regressionOf + ')')}.\n`);
            stderr.write(`[rewind] Run: ${s.cyan(`rewind triage ${savedRecord.id}`)} or ${s.cyan(`rewind show ${savedRecord.id}`)}\n\n`);
          } else {
            stderr.write(`\n${tag} Failure recorded as incident ${idText}.\n`);
            stderr.write(`[rewind] Run: ${s.cyan(`rewind triage ${savedRecord.id}`)}\n\n`);
          }
        }
      }
    } catch {
      // Invariant: Fail silently if error occurs during passive recording so original execution is never interrupted
    }

    return 0;
  }

  // Shell script generation
  if (!target) {
    stdout.write(getInstallationOverview(s) + '\n');
    return 0;
  }

  const normalizedShell = normalizeShellName(target);
  if (!normalizedShell) {
    throw new InvalidArgumentError(
      `Unsupported shell: "${target}". Supported shells: ${SUPPORTED_SHELLS.join(', ')}.\n` +
      `Run "rewind hook" without arguments for installation guidance.`
    );
  }

  switch (normalizedShell) {
    case 'bash':
      stdout.write(getBashHook());
      break;
    case 'zsh':
      stdout.write(getZshHook());
      break;
    case 'fish':
      stdout.write(getFishHook());
      break;
    case 'powershell':
      stdout.write(getPowerShellHook());
      break;
    default:
      stdout.write(getInstallationOverview(s) + '\n');
      break;
  }

  return 0;
}
