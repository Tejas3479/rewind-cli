import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi, sanitizeOutput, redactSecrets, sanitizeForDisplay } from '../src/sanitizer.js';

describe('Output Sanitizer & Anti-Escape (src/sanitizer.js)', () => {
  test('stripAnsi removes color and style escape codes', () => {
    const colored = '\x1b[31mRed\x1b[0m \x1b[1mBold\x1b[0m \x1b[32;4mGreen Underlined\x1b[0m';
    assert.equal(stripAnsi(colored), 'Red Bold Green Underlined');
  });

  test('stripAnsi removes cursor movement and screen clear sequences', () => {
    const sequences = '\x1b[2J\x1b[HHello\x1b[1A\x1b[2KWorld';
    assert.equal(stripAnsi(sequences), 'HelloWorld');
  });

  test('sanitizeOutput normalizes line breaks and strips control characters', () => {
    const raw = 'Line 1\r\n\x1b[31mLine 2\x1b[0m\rLine 3\x00\x07\x1b';
    const clean = sanitizeOutput(raw);
    assert.equal(clean, 'Line 1\nLine 2\nLine 3');
  });

  test('handles null, undefined, and non-string values gracefully', () => {
    assert.equal(stripAnsi(null), '');
    assert.equal(stripAnsi(undefined), '');
    assert.equal(sanitizeOutput(null), '');
    assert.equal(redactSecrets(null), '');
    assert.equal(redactSecrets(undefined), '');
    assert.equal(sanitizeForDisplay(null), '');
    assert.equal(sanitizeForDisplay(undefined), '');
  });

  describe('redactSecrets Pattern Coverage', () => {
    test('redacts PEM private key blocks (Pattern 1)', () => {
      const raw = 'Config:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0m...fakeKeyContent...\n-----END RSA PRIVATE KEY-----\nDone';
      const clean = redactSecrets(raw);
      assert.equal(clean, 'Config:\n[REDACTED_PRIVATE_KEY]\nDone');

      const rawEc = '-----BEGIN EC PRIVATE KEY-----\nsecret_bytes\n-----END EC PRIVATE KEY-----';
      assert.equal(redactSecrets(rawEc), '[REDACTED_PRIVATE_KEY]');
    });

    test('redacts OpenAI API keys (Pattern 2)', () => {
      const dummyOpenAi = ['sk', 'proj', '1234567890abcdefghijklmnopqrstuvwxyz_123'].join('-');
      const raw = `Error using ${dummyOpenAi} in request`;
      assert.equal(redactSecrets(raw), 'Error using [REDACTED_API_KEY] in request');
    });

    test('redacts GitHub Personal Access Tokens and OAuth tokens (Pattern 3)', () => {
      const dummyGhp = ['ghp', '012345678901234567890123456789012345'].join('_');
      const ghp = `git clone https://${dummyGhp}@github.com/repo.git`;
      assert.equal(redactSecrets(ghp), 'git clone https://[REDACTED_GITHUB_TOKEN]@github.com/repo.git');

      const dummyPat = ['github', 'pat', '11AAAAAAA0123456789abcdefghijklmnopqrstuvwxyz'].join('_');
      const pat = `Auth token: ${dummyPat}`;
      assert.equal(redactSecrets(pat), 'Auth token: [REDACTED_GITHUB_TOKEN]');
    });

    test('redacts AWS Access Key IDs (Pattern 4)', () => {
      const akia = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      assert.equal(redactSecrets(akia), 'AWS_ACCESS_KEY_ID=[REDACTED_AWS_KEY]');

      const asia = 'Session key ASIAIOSFODNN7EXAMPLE expired';
      assert.equal(redactSecrets(asia), 'Session key [REDACTED_AWS_KEY] expired');
    });

    test('redacts Slack tokens (Pattern 5)', () => {
      const dummySlack = ['xoxb', '1234567890', '1234567890', 'abcdefghijklmnop'].join('-');
      const raw = `Notification failed with bot token ${dummySlack}`;
      assert.equal(redactSecrets(raw), 'Notification failed with bot token [REDACTED_SLACK_TOKEN]');
    });

    test('redacts Bearer authorization tokens (Pattern 6)', () => {
      const raw = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID';
      assert.equal(redactSecrets(raw), 'Authorization: Bearer [REDACTED]');
    });

    test('redacts Basic Auth URLs (Pattern 7)', () => {
      const raw = 'Failed connecting to postgres://admin:super_secret_pw@db.internal:5432/main';
      assert.equal(redactSecrets(raw), 'Failed connecting to postgres://[REDACTED]@db.internal:5432/main');
    });

    test('redacts key-value secret pairs including spaces in quotes (Pattern 8)', () => {
      assert.equal(redactSecrets('password="my secret token"'), 'password=[REDACTED]');
      assert.equal(redactSecrets("api_key: 'top-secret-key-123'"), 'api_key=[REDACTED]');
      assert.equal(redactSecrets('client_secret=unquotedSecret123'), 'client_secret=[REDACTED]');
      assert.equal(redactSecrets('auth_token: mySecretToken'), 'auth_token=[REDACTED]');
      assert.equal(redactSecrets('private_key="super secret private string"'), 'private_key=[REDACTED]');
    });
  });

  test('sanitizeForDisplay strips ANSI codes, normalizes line breaks, and redacts secrets', () => {
    const raw = '\x1b[31mError:\x1b[0m Invalid key \x1b[1msk-proj-1234567890abcdefghijklmnopqrstuvwxyz\x1b[0m\r\n';
    const display = sanitizeForDisplay(raw);
    assert.equal(display, 'Error: Invalid key [REDACTED_API_KEY]\n');
  });
});

