import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, COMMANDS } from '../src/router.js';
import { UnknownCommandError } from '../src/errors.js';
import { createStyler } from '../src/formatter.js';

function createMockContext(parsedArgs = {}) {
  let stdoutData = '';
  let stderrData = '';
  return {
    context: {
      argv: [],
      parsedArgs: {
        command: null,
        positional: [],
        flags: { help: false, version: false, json: false, noColor: false, root: null },
        raw: [],
        ...parsedArgs
      },
      config: { rootDir: process.cwd(), ledgerDir: `${process.cwd()}/.rewind`, version: '0.1.0' },
      styler: createStyler(false),
      stdout: {
        write: (str) => {
          stdoutData += str;
          return true;
        }
      },
      stderr: {
        write: (str) => {
          stderrData += str;
          return true;
        }
      },
      stdin: {},
      env: {},
      cwd: process.cwd()
    },
    getStdout: () => stdoutData,
    getStderr: () => stderrData
  };
}

describe('Command Router (src/router.js)', () => {
  test('contains all 5 required MVP subcommands plus help and version', () => {
    assert.ok(COMMANDS.run);
    assert.ok(COMMANDS.history);
    assert.ok(COMMANDS.show);
    assert.ok(COMMANDS.recover);
    assert.ok(COMMANDS.verify);
    assert.ok(COMMANDS.help);
    assert.ok(COMMANDS.version);
  });

  test('routes to helpCommand when no command is specified', async () => {
    const mock = createMockContext({ command: null });
    const code = await dispatch({ context: mock.context });
    assert.equal(code, 0);
    assert.ok(mock.getStdout().includes('REWIND — Remember what fixed it.'));
  });

  test('routes to versionCommand when flags.version is true', async () => {
    const mock = createMockContext({ flags: { version: true, help: false, json: false, noColor: false, root: null } });
    const code = await dispatch({ context: mock.context });
    assert.equal(code, 0);
    assert.ok(mock.getStdout().includes('rewind v1.0.0'));
  });

  test('throws UnknownCommandError when an unrecognized command is given', async () => {
    const mock = createMockContext({ command: 'nonexistent-cmd' });
    await assert.rejects(
      async () => dispatch({ context: mock.context }),
      UnknownCommandError
    );
  });
});
