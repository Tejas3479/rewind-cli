import fs from 'node:fs';
import path from 'node:path';
import { readCheckpoint } from '../storage/journal.js';

export async function initCommand({ context }) {
  const { storage, stdout, styler, cwd } = context;

  const ledgerDir = storage.ledgerDir;
  const journalPath = path.join(ledgerDir, 'journal.jsonl');
  const alreadyInitialized = fs.existsSync(journalPath);
  
  const gitignorePath = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (!gitignore.split('\n').some(line => line.trim() === '.rewind/' || line.trim() === '.rewind')) {
      fs.appendFileSync(gitignorePath, '\n.rewind/\n');
    }
  } else {
    fs.writeFileSync(gitignorePath, '.rewind/\n');
  }

  if (alreadyInitialized) {
    const checkpoint = readCheckpoint(ledgerDir);
    const eventCount = checkpoint?.eventCount || 0;
    const records = storage.listRecords();
    const incidentCount = records.total || 0;

    stdout.write(styler.green(styler.bold('Rewind is already initialized in this directory.\n')));
    stdout.write(`Ledger: ${ledgerDir}\n`);
    stdout.write(`Incidents tracked: ${incidentCount}\n`);
    stdout.write(`Journal events: ${eventCount}\n`);
    return 0;
  }

  const shell = process.env.SHELL || '';
  let hookCmd = 'eval "$(rewind hook bash)"';
  if (shell.includes('zsh')) {
    hookCmd = 'eval "$(rewind hook zsh)"';
  } else if (process.env.PSModulePath) {
    hookCmd = 'Invoke-Expression (& rewind hook powershell | Out-String)';
  }

  stdout.write(styler.green(styler.bold('Initialized empty Rewind ledger in .rewind/\n\n')));
  stdout.write(styler.bold('Getting Started:\n'));
  stdout.write(`1. Install the shell hook to automatically record failed commands:\n`);
  stdout.write(styler.cyan(`   ${hookCmd}\n\n`));
  stdout.write(`2. Or run commands manually with Rewind:\n`);
  stdout.write(styler.cyan(`   rewind run npm test\n\n`));
  stdout.write(`3. View your history of failures and recoveries:\n`);
  stdout.write(styler.cyan(`   rewind history\n\n`));

  return 0;
}
