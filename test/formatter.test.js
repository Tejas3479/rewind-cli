import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldEnableColor,
  createStyler,
  formatJson,
  formatError,
  visibleLength,
  formatRelativeTime,
  formatStatusBadge,
  formatBox,
  formatUtc
} from '../src/formatter.js';

describe('Output Formatter & NO_COLOR (src/formatter.js)', () => {
  test('shouldEnableColor disables color when noColorFlag is true', () => {
    assert.equal(shouldEnableColor({ isTTY: true, env: { FORCE_COLOR: '1' }, noColorFlag: true }), false);
  });

  test('shouldEnableColor respects NO_COLOR environment variable (https://no-color.org)', () => {
    assert.equal(shouldEnableColor({ isTTY: true, env: { NO_COLOR: '1' } }), false);
    assert.equal(shouldEnableColor({ isTTY: true, env: { NO_COLOR: 'true' } }), false);
    assert.equal(shouldEnableColor({ isTTY: true, env: { NO_COLOR: '0' } }), false);
    // If NO_COLOR is empty string, standard says it does NOT disable
    assert.equal(shouldEnableColor({ isTTY: true, env: { NO_COLOR: '' } }), true);
  });

  test('shouldEnableColor respects FORCE_COLOR environment variable', () => {
    assert.equal(shouldEnableColor({ isTTY: false, env: { FORCE_COLOR: '1' } }), true);
    assert.equal(shouldEnableColor({ isTTY: false, env: { FORCE_COLOR: 'true' } }), true);
    assert.equal(shouldEnableColor({ isTTY: true, env: { FORCE_COLOR: '0' } }), false);
    assert.equal(shouldEnableColor({ isTTY: true, env: { FORCE_COLOR: 'false' } }), false);
  });

  test('shouldEnableColor respects isTTY when no overriding env vars exist', () => {
    assert.equal(shouldEnableColor({ isTTY: true, env: {} }), true);
    assert.equal(shouldEnableColor({ isTTY: false, env: {} }), false);
  });

  test('createStyler formats text with ANSI escape codes when enabled', () => {
    const styler = createStyler(true);
    const text = 'Hello';
    assert.equal(styler.bold(text), '\x1b[1mHello\x1b[0m');
    assert.equal(styler.red(text), '\x1b[31mHello\x1b[0m');
    assert.equal(styler.green(text), '\x1b[32mHello\x1b[0m');
    assert.equal(styler.dim(text), '\x1b[2mHello\x1b[0m');
    assert.equal(styler.badge('TEST'), '\x1b[1m[TEST]\x1b[0m');
  });

  test('createStyler returns raw unstyled text when disabled', () => {
    const styler = createStyler(false);
    const text = 'Hello';
    assert.equal(styler.bold(text), 'Hello');
    assert.equal(styler.red(text), 'Hello');
    assert.equal(styler.green(text), 'Hello');
    assert.equal(styler.dim(text), 'Hello');
    assert.equal(styler.badge('TEST'), '[TEST]');
  });

  test('formatJson outputs properly formatted JSON with 2-space indentation', () => {
    const data = { name: 'rewind', ok: true, count: 5 };
    const json = formatJson(data);
    assert.equal(json, JSON.stringify(data, null, 2));
    assert.deepEqual(JSON.parse(json), data);
  });

  test('formatError formats error message with prefix and optional hint', () => {
    const styler = createStyler(false);
    const err = new Error('Test failure');
    const formatted = formatError(err, styler);
    assert.equal(formatted, 'error: Test failure');

    const errWithDetails = new Error('Database locked');
    errWithDetails.details = { suggestion: 'Check if another process is running' };
    const formattedWithHint = formatError(errWithDetails, styler);
    assert.match(formattedWithHint, /error: Database locked/);
    assert.match(formattedWithHint, /hint: Check if another process is running/);
  });

  test('visibleLength calculates printable length ignoring ANSI codes', () => {
    assert.equal(visibleLength(null), 0);
    assert.equal(visibleLength(''), 0);
    assert.equal(visibleLength('plain text'), 10);
    assert.equal(visibleLength('\x1b[31mred\x1b[0m \x1b[1mbold\x1b[0m'), 8);
  });

  describe('formatRelativeTime', () => {
    const now = new Date('2026-09-21T12:00:00.000Z');

    test('handles missing or invalid date inputs gracefully', () => {
      assert.equal(formatRelativeTime(null), 'unknown');
      assert.equal(formatRelativeTime(''), 'unknown');
      assert.equal(formatRelativeTime('invalid-date-string'), 'invalid-date-string');
    });

    test('formats future dates', () => {
      const future = new Date('2026-09-21T13:00:00.000Z').toISOString();
      assert.equal(formatRelativeTime(future, now), 'in the future');
    });

    test('formats intervals accurately across seconds, minutes, hours, days, months, and years', () => {
      // Just now (<45s)
      const sec20 = new Date('2026-09-21T11:59:40.000Z').toISOString();
      assert.equal(formatRelativeTime(sec20, now), 'just now');

      // 1m ago (<90s)
      const sec60 = new Date('2026-09-21T11:59:00.000Z').toISOString();
      assert.equal(formatRelativeTime(sec60, now), '1m ago');

      // Minutes (<60m)
      const min15 = new Date('2026-09-21T11:45:00.000Z').toISOString();
      assert.equal(formatRelativeTime(min15, now), '15m ago');

      // Hours (<24h)
      const hours3 = new Date('2026-09-21T09:00:00.000Z').toISOString();
      assert.equal(formatRelativeTime(hours3, now), '3h ago');

      // Days (<30d)
      const days4 = new Date('2026-09-17T12:00:00.000Z').toISOString();
      assert.equal(formatRelativeTime(days4, now), '4d ago');

      // Months (<12mo)
      const months3 = new Date('2026-06-21T12:00:00.000Z').toISOString();
      assert.equal(formatRelativeTime(months3, now), '3mo ago');

      // Years
      const years2 = new Date('2024-09-21T12:00:00.000Z').toISOString();
      assert.equal(formatRelativeTime(years2, now), '2y ago');
    });
  });

  describe('formatStatusBadge', () => {
    test('formats semantic status badges for all states in colored and uncolored modes', () => {
      const plain = createStyler(false);
      assert.equal(plain.stripAnsi(formatStatusBadge('RECOVERED', plain)), 'RECOVERED');
      assert.equal(plain.stripAnsi(formatStatusBadge('VERIFIED', plain)), 'VERIFIED');
      assert.equal(plain.stripAnsi(formatStatusBadge('REGRESSED', plain)), 'REGRESSED');
      assert.equal(plain.stripAnsi(formatStatusBadge('OPEN', plain)), 'OPEN');
      assert.equal(plain.stripAnsi(formatStatusBadge('FIXED', plain)), 'FIXED');
      assert.equal(plain.stripAnsi(formatStatusBadge('SUSPECTED', plain)), 'SUSPECTED');
      assert.equal(plain.stripAnsi(formatStatusBadge('PROPOSED', plain)), 'PROPOSED');
      assert.equal(plain.stripAnsi(formatStatusBadge('ATTEMPTED', plain)), 'ATTEMPTED');
      assert.equal(plain.stripAnsi(formatStatusBadge('FAILED', plain)), 'FAILED');
      assert.equal(plain.stripAnsi(formatStatusBadge('RESOLVED', plain)), 'RESOLVED');
      assert.equal(plain.stripAnsi(formatStatusBadge('OBSERVED', plain)), 'OBSERVED');
      assert.equal(plain.stripAnsi(formatStatusBadge(null, plain)), 'OBSERVED');

      const colored = createStyler(true);
      assert.match(formatStatusBadge('VERIFIED', colored), /\x1b\[32m/);
      assert.match(formatStatusBadge('REGRESSED', colored), /\x1b\[31m/);
      assert.match(formatStatusBadge('SUSPECTED', colored), /\x1b\[33m/);
      assert.match(formatStatusBadge('OPEN', colored), /\x1b\[36m/);
      assert.match(formatStatusBadge('RESOLVED', colored), /\x1b\[34m/);
      assert.match(formatStatusBadge('OBSERVED', colored), /\x1b\[2m/);
    });
  });

  describe('formatBox', () => {
    test('renders structured border box with title and fields cleanly', () => {
      const styler = createStyler(false);
      const fields = [
        { label: 'Incident', value: '#1' },
        { label: 'Verify Command', value: 'npm test' },
        { label: 'Exit Code', value: '0 (Success)' }
      ];

      const box = formatBox('RECOVERY VERIFIED', fields, styler, 'success');
      assert.match(box, /^┌─+┐/);
      assert.match(box, /│ RECOVERY VERIFIED/);
      assert.match(box, /│ Incident:\s+#1/);
      assert.match(box, /│ Verify Command:\s+npm test/);
      assert.match(box, /│ Exit Code:\s+0 \(Success\)/);
      assert.match(box, /└─+┘$/);
    });

    test('dynamically expands width when a field label exceeds standard padding', () => {
      const styler = createStyler(false);
      const fields = [
        { label: 'A Very Long Custom Configuration Parameter Label', value: 'Enabled' }
      ];

      const box = formatBox('WIDE BOX', fields, styler, 'info');
      const lines = box.split('\n');
      const firstLineLen = lines[0].length;
      for (const line of lines) {
        assert.equal(visibleLength(line), firstLineLen, 'Box borders should be evenly aligned');
      }
    });
  });

  describe('formatUtc', () => {
    test('formats valid ISO string into UTC timestamp format', () => {
      const formatted = formatUtc('2026-09-21T08:30:15.000Z');
      assert.equal(formatted, '2026-09-21 08:30:15 UTC');
    });

    test('handles invalid or empty dates gracefully', () => {
      assert.equal(formatUtc(''), 'unknown');
      assert.equal(formatUtc(null), 'unknown');
      assert.equal(formatUtc('invalid'), 'Invalid Date');
    });
  });
});

