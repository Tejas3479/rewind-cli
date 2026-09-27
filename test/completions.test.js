import test from 'node:test';
import assert from 'node:assert/strict';
import { completionsCommand } from '../src/commands/completions.js';

test('completions command', async (t) => {
  let output = '';
  const contextBase = {
    stdout: {
      write(chunk) {
        output += chunk;
      }
    }
  };

  await t.test('bash completions output contains _rewind, complete -F, setup/event, and valid hook subcommands', async () => {
    output = '';
    await completionsCommand({
      context: {
        ...contextBase,
        parsedArgs: { positional: ['bash'] }
      }
    });
    assert.match(output, /_rewind/);
    assert.match(output, /complete -F _rewind/);
    assert.match(output, /setup/);
    assert.match(output, /event/);
    assert.match(output, /compgen -W "bash zsh powershell fish record" -- "\$cur"/);
    assert.doesNotMatch(output, /install uninstall status/);
  });

  await t.test('zsh completions output contains compdef, setup/event, and valid hook subcommands', async () => {
    output = '';
    await completionsCommand({
      context: {
        ...contextBase,
        parsedArgs: { positional: ['zsh'] }
      }
    });
    assert.match(output, /compdef _rewind rewind/);
    assert.match(output, /_rewind\(\)/);
    assert.match(output, /'setup:Configure AI agent integrations'/);
    assert.match(output, /'event:Ingest external agent events'/);
    assert.match(output, /hook_cmds=\('bash' 'zsh' 'powershell' 'fish' 'record'\)/);
    assert.doesNotMatch(output, /'install' 'uninstall' 'status'/);
  });

  await t.test('powershell completions output contains Register-ArgumentCompleter, setup/event, and valid hook subcommands', async () => {
    output = '';
    await completionsCommand({
      context: {
        ...contextBase,
        parsedArgs: { flags: { shell: 'powershell' } }
      }
    });
    assert.match(output, /Register-ArgumentCompleter -Native -CommandName rewind/);
    assert.match(output, /'setup'/);
    assert.match(output, /'event'/);
    assert.match(output, /@\('bash', 'zsh', 'powershell', 'fish', 'record'\)/);
    assert.doesNotMatch(output, /'install', 'uninstall', 'status'/);
  });

  await t.test('fish completions output contains complete -c rewind, setup/event, and valid hook subcommands', async () => {
    output = '';
    await completionsCommand({
      context: {
        ...contextBase,
        parsedArgs: { positional: ['fish'] }
      }
    });
    assert.match(output, /complete -c rewind/);
    assert.match(output, /-a "setup"/);
    assert.match(output, /-a "event"/);
    assert.match(output, /-a "bash zsh powershell fish record"/);
    assert.doesNotMatch(output, /install uninstall status/);
  });

  await t.test('unknown shell returns error', async () => {
    output = '';
    await assert.rejects(
      completionsCommand({
        context: {
          ...contextBase,
          parsedArgs: { positional: ['unknown'] }
        }
      }),
      (err) => err.name === 'CliError' && err.message.includes('Unsupported shell')
    );
  });

  await t.test('missing shell returns error', async () => {
    output = '';
    await assert.rejects(
      completionsCommand({
        context: {
          ...contextBase,
          parsedArgs: { positional: [], flags: {} }
        }
      }),
      (err) => err.name === 'CliError' && err.message.includes('Missing shell argument')
    );
  });
});
