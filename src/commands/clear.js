import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Handler for `rewind clear`.
 * Deletes the local recovery ledger after explicit user confirmation.
 *
 * @param {object} params
 * @param {import('../cli.js').CliContext} params.context
 * @returns {Promise<number>}
 */
export async function clearCommand({ context }) {
  const { parsedArgs, storage, stdout, stderr, stdin, styler, isTTY, config } = context;
  const s = styler;
  const ledgerDir = config.ledgerDir;
  const force = parsedArgs.flags.force || parsedArgs.flags.yes;

  if (!fs.existsSync(ledgerDir)) {
    stdout.write(s.dim('No ledger found. Nothing to clear.') + '\n');
    return 0;
  }

  // Gather stats before clearing
  const { total } = storage.listRecords();
  const journalPath = path.join(ledgerDir, 'journal.jsonl');
  let eventCount = 0;
  try {
    if (fs.existsSync(journalPath)) {
      const content = fs.readFileSync(journalPath, 'utf8');
      eventCount = content.split('\n').filter((l) => l.trim()).length;
    }
  } catch {
    // Ignore read errors
  }

  if (parsedArgs.flags.json) {
    if (!force) {
      stdout.write(JSON.stringify({
        status: 'error',
        error: { message: 'Use --force to clear without confirmation in JSON mode' }
      }, null, 2) + '\n');
      return 1;
    }

    clearLedger(ledgerDir);
    stdout.write(JSON.stringify({
      status: 'success',
      cleared: { incidents: total, events: eventCount, ledgerDir }
    }, null, 2) + '\n');
    return 0;
  }

  // Print what will be deleted
  stdout.write('\n');
  stdout.write('  ' + s.bold(s.red('\u26A0  DESTRUCTIVE OPERATION')) + '\n');
  stdout.write('\n');
  stdout.write('  Ledger:    ' + s.cyan(ledgerDir) + '\n');
  stdout.write('  Incidents: ' + s.bold(String(total)) + '\n');
  stdout.write('  Events:    ' + s.bold(String(eventCount)) + '\n');
  stdout.write('\n');
  stdout.write('  This will ' + s.red('permanently delete') + ' the entire recovery ledger,\n');
  stdout.write('  including all incidents, evidence, and the cryptographic journal.\n');
  stdout.write('\n');

  if (force) {
    clearLedger(ledgerDir);
    stdout.write('  ' + s.green('\u2713') + ' Ledger cleared.\n\n');
    return 0;
  }

  if (!isTTY) {
    stderr.write(s.red('Error:') + ' Cannot prompt for confirmation in non-interactive mode. Use --force.\n');
    return 1;
  }

  // Interactive confirmation
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await new Promise((resolve) => {
    rl.question('  ' + s.yellow('Type "clear" to confirm:') + ' ', resolve);
  });
  rl.close();

  if (answer.trim().toLowerCase() !== 'clear') {
    stdout.write('\n  ' + s.dim('Aborted. Ledger is unchanged.') + '\n\n');
    return 1;
  }

  clearLedger(ledgerDir);
  stdout.write('\n  ' + s.green('\u2713') + ' Ledger cleared. Run ' + s.cyan('rewind run <command>') + ' to start fresh.\n\n');
  return 0;
}

/**
 * Removes the ledger directory and all its contents.
 *
 * @param {string} ledgerDir - Absolute path to .rewind directory
 */
function clearLedger(ledgerDir) {
  fs.rmSync(ledgerDir, { recursive: true, force: true });
}
