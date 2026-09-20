import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, hasShellOperators, tokenizeCommandLine } from '../src/parser.js';
import { InvalidArgumentError } from '../src/errors.js';

describe('Argument Parser (src/parser.js)', () => {
  test('parses empty args as null command and default flags', () => {
    const result = parseArgs([]);
    assert.equal(result.command, null);
    assert.deepEqual(result.positional, []);
    assert.equal(result.flags.help, false);
    assert.equal(result.flags.version, false);
    assert.equal(result.flags.json, false);
    assert.equal(result.flags.noColor, false);
    assert.equal(result.flags.root, null);
  });

  test('parses --help and -h flags', () => {
    assert.equal(parseArgs(['--help']).flags.help, true);
    assert.equal(parseArgs(['-h']).flags.help, true);
  });

  test('parses --version and -v flags', () => {
    assert.equal(parseArgs(['--version']).flags.version, true);
    assert.equal(parseArgs(['-v']).flags.version, true);
  });

  test('parses --json flag', () => {
    const result = parseArgs(['history', '--json']);
    assert.equal(result.command, 'history');
    assert.equal(result.flags.json, true);
  });

  test('parses --no-color flag', () => {
    const result = parseArgs(['--no-color', 'history']);
    assert.equal(result.command, 'history');
    assert.equal(result.flags.noColor, true);
  });

  test('parses --root flag with space and with equals', () => {
    const res1 = parseArgs(['--root', '/custom/path', 'history']);
    assert.equal(res1.flags.root, '/custom/path');
    assert.equal(res1.command, 'history');

    const res2 = parseArgs(['--root=/custom/path', 'show', '1']);
    assert.equal(res2.flags.root, '/custom/path');
    assert.equal(res2.command, 'show');
    assert.deepEqual(res2.positional, ['1']);
  });

  test('throws InvalidArgumentError when --root is missing a path value', () => {
    assert.throws(() => parseArgs(['--root']), InvalidArgumentError);
    assert.throws(() => parseArgs(['--root', '--json']), InvalidArgumentError);
    assert.throws(() => parseArgs(['--root=']), InvalidArgumentError);
  });

  test('preserves all trailing arguments for "run" command', () => {
    const result = parseArgs(['run', 'npm', 'test', '--coverage', '--json']);
    assert.equal(result.command, 'run');
    assert.deepEqual(result.positional, ['npm', 'test', '--coverage', '--json']);
  });

  test('normalizes "rewind help [cmd]" to help command and target subcommand', () => {
    const res1 = parseArgs(['help']);
    assert.equal(res1.command, null);
    assert.equal(res1.flags.help, true);

    const res2 = parseArgs(['help', 'show']);
    assert.equal(res2.command, 'show');
    assert.equal(res2.flags.help, true);
  });

  test('throws InvalidArgumentError for unrecognized flags on root/commands', () => {
    assert.throws(() => parseArgs(['--unknown-flag']), InvalidArgumentError);
    assert.throws(() => parseArgs(['history', '--invalid']), InvalidArgumentError);
  });

  test('parses and validates --limit and -n flags properly', () => {
    const res1 = parseArgs(['history', '--limit', '5']);
    assert.equal(res1.flags.limit, 5);

    const res2 = parseArgs(['history', '-n', '10']);
    assert.equal(res2.flags.limit, 10);

    const res3 = parseArgs(['history', '--limit=20']);
    assert.equal(res3.flags.limit, 20);

    assert.throws(() => parseArgs(['history', '--limit']), InvalidArgumentError);
    assert.throws(() => parseArgs(['history', '--limit', '-1']), InvalidArgumentError);
    assert.throws(() => parseArgs(['history', '--limit', '0']), InvalidArgumentError);
    assert.throws(() => parseArgs(['history', '--limit', 'abc']), InvalidArgumentError);
  });

  test('parses and validates --timeout / -t and --shell flags', () => {
    const res1 = parseArgs(['verify', '1', '--timeout', '5000', '--shell']);
    assert.equal(res1.flags.timeout, 5000);
    assert.equal(res1.flags.shell, true);

    const res2 = parseArgs(['verify', '1', '-t', '10000']);
    assert.equal(res2.flags.timeout, 10000);

    const res3 = parseArgs(['verify', '1', '--timeout=2500']);
    assert.equal(res3.flags.timeout, 2500);

    assert.throws(() => parseArgs(['verify', '1', '--timeout']), InvalidArgumentError);
    assert.throws(() => parseArgs(['verify', '1', '--timeout', '-1']), InvalidArgumentError);
    assert.throws(() => parseArgs(['verify', '1', '--timeout', '0']), InvalidArgumentError);
    assert.throws(() => parseArgs(['verify', '1', '--timeout', 'invalid']), InvalidArgumentError);
  });

  describe('hasShellOperators', () => {
    test('detects unquoted shell control operators', () => {
      assert.equal(hasShellOperators('npm test && npm run build'), true);
      assert.equal(hasShellOperators('cargo check || cargo build'), true);
      assert.equal(hasShellOperators('echo a; echo b'), true);
      assert.equal(hasShellOperators('cat file | grep error'), true);
      assert.equal(hasShellOperators('run_task &'), true);
      assert.equal(hasShellOperators('echo test > out.log'), true);
      assert.equal(hasShellOperators('cat < input.txt'), true);
    });

    test('ignores operators inside single or double quotes', () => {
      assert.equal(hasShellOperators('echo "a && b"'), false);
      assert.equal(hasShellOperators("echo 'a || b'"), false);
      assert.equal(hasShellOperators('git commit -m "feat: a & b > c; d | e"'), false);
    });

    test('detects operators outside when quotes are escaped', () => {
      assert.equal(hasShellOperators('echo \\"a && b\\"'), true);
      assert.equal(hasShellOperators("echo \\'a || b\\'"), true);
    });

    test('handles empty or non-string inputs safely', () => {
      assert.equal(hasShellOperators(''), false);
      assert.equal(hasShellOperators(null), false);
      assert.equal(hasShellOperators(undefined), false);
    });
  });

  describe('tokenizeCommandLine', () => {
    test('tokenizes simple commands separated by spaces', () => {
      assert.deepEqual(tokenizeCommandLine('npm run build --prod'), ['npm', 'run', 'build', '--prod']);
    });

    test('respects single and double quotes containing spaces', () => {
      assert.deepEqual(
        tokenizeCommandLine('git commit -m "feat: first commit" --author=\'Jane Doe\''),
        ['git', 'commit', '-m', 'feat: first commit', '--author=Jane Doe']
      );
    });

    test('preserves escaped quotes inside arguments', () => {
      assert.deepEqual(
        tokenizeCommandLine('node -e "console.log(\\"hello\\")"'),
        ['node', '-e', 'console.log("hello")']
      );
    });

    test('handles empty, null, or multiple whitespace delimiters cleanly', () => {
      assert.deepEqual(tokenizeCommandLine(''), []);
      assert.deepEqual(tokenizeCommandLine(null), []);
      assert.deepEqual(tokenizeCommandLine('   cargo    build    --release   '), ['cargo', 'build', '--release']);
    });
  });

  describe('20+ CLI Flags & Subcommand Options', () => {
    test('parses and validates --offset flag', () => {
      assert.equal(parseArgs(['history', '--offset', '5']).flags.offset, 5);
      assert.equal(parseArgs(['history', '--offset=10']).flags.offset, 10);
      assert.equal(parseArgs(['history', '--offset', '0']).flags.offset, 0);

      assert.throws(() => parseArgs(['history', '--offset', '-1']), InvalidArgumentError);
      assert.throws(() => parseArgs(['history', '--offset', 'abc']), InvalidArgumentError);
      assert.throws(() => parseArgs(['history', '--offset']), InvalidArgumentError);
    });

    test('parses --cause and -c flags', () => {
      assert.equal(parseArgs(['recover', '1', '--cause', 'Port busy']).flags.cause, 'Port busy');
      assert.equal(parseArgs(['recover', '1', '-c', 'Missing dependency']).flags.cause, 'Missing dependency');
      assert.equal(parseArgs(['recover', '1', '--cause=DB down']).flags.cause, 'DB down');
      assert.throws(() => parseArgs(['recover', '1', '--cause']), InvalidArgumentError);
    });

    test('parses --change, --fix, and -m flags', () => {
      assert.equal(parseArgs(['recover', '1', '--change', 'Updated port']).flags.change, 'Updated port');
      assert.equal(parseArgs(['recover', '1', '--fix', 'Installed pkg']).flags.change, 'Installed pkg');
      assert.equal(parseArgs(['recover', '1', '-m', 'Migrated db']).flags.change, 'Migrated db');
      assert.equal(parseArgs(['recover', '1', '--change=Restarted']).flags.change, 'Restarted');
      assert.throws(() => parseArgs(['recover', '1', '--change']), InvalidArgumentError);
    });

    test('parses --verify-cmd and --verify flags', () => {
      assert.equal(parseArgs(['recover', '1', '--verify-cmd', 'npm test']).flags.verifyCmd, 'npm test');
      assert.equal(parseArgs(['recover', '1', '--verify', 'pytest']).flags.verifyCmd, 'pytest');
      assert.equal(parseArgs(['recover', '1', '--verify-cmd=cargo test']).flags.verifyCmd, 'cargo test');
      assert.throws(() => parseArgs(['recover', '1', '--verify-cmd']), InvalidArgumentError);
    });

    test('parses --fingerprint and -f flags', () => {
      assert.equal(parseArgs(['search', '--fingerprint', 'abc12345']).flags.fingerprint, 'abc12345');
      assert.equal(parseArgs(['search', '-f', 'deadbeef']).flags.fingerprint, 'deadbeef');
      assert.equal(parseArgs(['search', '--fingerprint=cafebabe']).flags.fingerprint, 'cafebabe');
      assert.throws(() => parseArgs(['search', '--fingerprint']), InvalidArgumentError);
    });

    test('parses boolean diagnostic flags: --explain, --repair, --dry-run, --fixed', () => {
      const res = parseArgs(['doctor', '--explain', '--repair', '--dry-run', '--fixed']);
      assert.equal(res.flags.explain, true);
      assert.equal(res.flags.repair, true);
      assert.equal(res.flags.dryRun, true);
      assert.equal(res.flags.fixed, true);
    });

    test('parses hook recording flags: --cmd, --exit, --duration, --cwd, --stderr', () => {
      const res = parseArgs([
        'hook', 'record',
        '--cmd', 'npm test',
        '--exit', '1',
        '--duration', '150',
        '--cwd', '/workspace',
        '--stderr', 'Error text'
      ]);
      assert.equal(res.flags.cmd, 'npm test');
      assert.equal(res.flags.exit, 1);
      assert.equal(res.flags.duration, 150);
      assert.equal(res.flags.cwd, '/workspace');
      assert.equal(res.flags.stderr, 'Error text');

      // Test negative exit code and equals syntax
      const res2 = parseArgs(['hook', 'record', '--exit=-1', '--duration=0']);
      assert.equal(res2.flags.exit, -1);
      assert.equal(res2.flags.duration, 0);

      assert.throws(() => parseArgs(['hook', 'record', '--duration', '-5']), InvalidArgumentError);
      assert.throws(() => parseArgs(['hook', 'record', '--exit', 'not_a_num']), InvalidArgumentError);
    });

    test('parses export/import flags: --output, -o, --include-unverified, --all, --overwrite', () => {
      const res1 = parseArgs(['export-shared', '--output', './bundle.json', '--include-unverified', '--overwrite']);
      assert.equal(res1.flags.output, './bundle.json');
      assert.equal(res1.flags.includeUnverified, true);
      assert.equal(res1.flags.overwrite, true);

      const res2 = parseArgs(['export-shared', '-o', './bundle.json', '--all']);
      assert.equal(res2.flags.output, './bundle.json');
      assert.equal(res2.flags.includeUnverified, true);

      assert.throws(() => parseArgs(['export-shared', '--output']), InvalidArgumentError);
    });

    test('parses common modifier flags: --force, --yes, -y, --quiet, -q', () => {
      assert.equal(parseArgs(['clear', '--force']).flags.force, true);
      assert.equal(parseArgs(['clear', '--yes']).flags.force, true);
      assert.equal(parseArgs(['clear', '-y']).flags.force, true);
      assert.equal(parseArgs(['clear', '--quiet']).flags.quiet, true);
      assert.equal(parseArgs(['clear', '-q']).flags.quiet, true);
    });

    test('parses run command with -- separator and runner options', () => {
      const res = parseArgs(['run', '--shell', '--root', '/custom', '--', 'echo', '--not-a-flag']);
      assert.equal(res.command, 'run');
      assert.equal(res.flags.shell, true);
      assert.equal(res.flags.root, '/custom');
      assert.deepEqual(res.positional, ['echo', '--not-a-flag']);
    });
  });
});

