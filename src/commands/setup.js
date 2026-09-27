import path from 'node:path';
import readline from 'node:readline';
import { formatJson } from '../formatter.js';
import { detectAgentEnvironments, installAllDetected } from '../integrations/index.js';

/**
 * Handler for `rewind setup [--dry-run] [--yes] [--json]`.
 * Inspects workspace, detects installed coding agents (Cursor, Gemini, Codex),
 * and configures ambient failure hooks so Rewind runs automatically without prompt clutter.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function setupCommand({ context }) {
  const { parsedArgs, config, stdout, stdin, isTTY, styler } = context;
  const s = styler;

  const rootDir = parsedArgs.flags.root || config?.rootDir || process.cwd();
  const isDryRun = Boolean(parsedArgs.flags['dry-run'] || parsedArgs.flags.dryRun);
  const isJson = Boolean(parsedArgs.flags.json);
  const hasYes = Boolean(parsedArgs.flags.yes || parsedArgs.flags.force || parsedArgs.flags.y);

  const detection = detectAgentEnvironments(rootDir);

  // If in interactive TTY and not confirmed via --yes/--dry-run/--json, prompt for confirmation
  if (isTTY && !hasYes && !isDryRun && !isJson) {
    stdout.write('\n' + s.bold('REWIND AGENT SETUP') + '\n');
    stdout.write(s.dim('────────────────────────────────────────────────────────────────────────\n'));
    stdout.write(`  ${s.dim('Workspace Root:')}   ${rootDir}\n`);
    if (detection.detected.length > 0) {
      stdout.write(`  ${s.dim('Detected Agents:')}  ${s.green(detection.detected.join(', '))}\n`);
    } else {
      stdout.write(`  ${s.dim('Detected Agents:')}  ${s.yellow('None specifically detected (defaulting to Cursor)')}\n`);
    }
    stdout.write('\n');

    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answer = await new Promise((resolve) => {
      rl.question('Configure Rewind integrations for detected coding agents? [Y/n]: ', resolve);
    });
    rl.close();

    if (answer && answer.trim().toLowerCase().startsWith('n')) {
      stdout.write('\n' + s.dim('Setup cancelled. No files were modified.') + '\n\n');
      return 0;
    }
  }

  const result = installAllDetected(rootDir, { dryRun: isDryRun });

  if (isJson) {
    stdout.write(formatJson({
      rootDir,
      isDryRun,
      detectedAgents: detection.detected,
      installed: result.installed,
      filesCreated: result.filesCreated
    }) + '\n');
    return 0;
  }

  stdout.write('\n' + s.bold('REWIND AGENT SETUP') + '\n');
  stdout.write(s.dim('────────────────────────────────────────────────────────────────────────\n'));
  stdout.write(`  ${s.dim('Workspace Root:')}   ${rootDir}\n`);

  if (detection.detected.length > 0) {
    stdout.write(`  ${s.dim('Detected Agents:')}  ${s.green(detection.detected.join(', '))}\n`);
  } else {
    stdout.write(`  ${s.dim('Detected Agents:')}  ${s.yellow('None specifically detected (defaulting to Cursor)')}\n`);
  }

  stdout.write('\n' + s.bold('Configured Integrations') + ':\n');
  for (const agent of result.installed) {
    stdout.write(`  ${s.green('✔')} ${agent} post-tool failure hook\n`);
  }

  stdout.write('\n' + s.bold(isDryRun ? 'Files that would be created:' : 'Files created / updated:') + '\n');
  for (const file of result.filesCreated) {
    const rel = path.relative(rootDir, file) || file;
    stdout.write(`  ${s.cyan('•')} ${rel}\n`);
  }

  stdout.write('\n' + s.green(s.bold('Setup complete!')) + ' Rewind is now ambiently listening for tool failures.\n');
  stdout.write(s.dim('When tests or commands fail, verified remedies will be surfaced directly to your agent.\n\n'));

  return 0;
}
