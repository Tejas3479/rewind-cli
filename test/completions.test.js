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

  await t.test('bash completions output contains _rewind or complete -F', async () => {
    output = '';
    await completionsCommand({
      context: {
        ...contextBase,
        parsedArgs: { positional: ['bash'] }
      }
    });
    assert.match(output, /_rewind/);
    assert.match(output, /complete -F _rewind/);
  });

  await t.test('zsh completions output contains compdef or _rewind', async () => {
    output = '';
    await completionsCommand({
      context: {
        ...contextBase,
        parsedArgs: { positional: ['zsh'] }
      }
    });
    assert.match(output, /compdef _rewind rewind/);
    assert.match(output, /_rewind\(\)/);
  });

  await t.test('powershell completions output contains Register-ArgumentCompleter', async () => {
    output = '';
    await completionsCommand({
      context: {
        ...contextBase,
        parsedArgs: { flags: { shell: 'powershell' } }
      }
    });
    assert.match(output, /Register-ArgumentCompleter -Native -CommandName rewind/);
  });

  await t.test('fish completions output contains complete -c rewind', async () => {
    output = '';
    await completionsCommand({
      context: {
        ...contextBase,
        parsedArgs: { positional: ['fish'] }
      }
    });
    assert.match(output, /complete -c rewind/);
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
