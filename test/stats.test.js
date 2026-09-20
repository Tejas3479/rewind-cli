import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { statsCommand } from '../src/commands/stats.js';
import { createStyler } from '../src/formatter.js';

describe('rewind stats command', () => {
  test('computes stats on empty ledger', async () => {
    let stdoutData = '';
    const context = {
      storage: {
        ledgerDir: '/tmp/fake',
        listRecords: () => ({ records: [], total: 0 })
      },
      parsedArgs: { flags: { json: true } },
      styler: {},
      stdout: {
        write: (text) => { stdoutData += text; }
      }
    };

    const exitCode = await statsCommand({ context });
    assert.equal(exitCode, 0);

    const stats = JSON.parse(stdoutData);
    assert.equal(stats.totalIncidents, 0);
    assert.equal(stats.verifiedFixes, 0);
  });

  test('computes stats with incidents', async () => {
    let stdoutData = '';
    const context = {
      storage: {
        ledgerDir: '/tmp/fake',
        listRecords: () => ({
          total: 2,
          records: [
            {
              status: 'VERIFIED',
              fingerprint: 'A',
              startTime: '2023-01-01T00:00:00Z',
              recoveryAttempts: [
                {
                  createdAt: '2023-01-01T00:00:10Z',
                  verificationRuns: [
                    { exitCode: 1 },
                    { exitCode: 0 }
                  ]
                }
              ]
            },
            {
              status: 'OPEN',
              fingerprint: 'A',
              startTime: '2023-01-01T00:00:00Z'
            }
          ]
        })
      },
      parsedArgs: { flags: { json: true } },
      styler: {},
      stdout: {
        write: (text) => { stdoutData += text; }
      }
    };

    const exitCode = await statsCommand({ context });
    assert.equal(exitCode, 0);

    const stats = JSON.parse(stdoutData);
    assert.equal(stats.totalIncidents, 2);
    assert.equal(stats.statusBreakdown.VERIFIED, 1);
    assert.equal(stats.statusBreakdown.OPEN, 1);
    assert.equal(stats.mostCommonErrorFingerprint, 'A');
    assert.equal(stats.failedApproaches, 1);
    assert.equal(stats.verifiedFixes, 1);
    assert.equal(stats.totalRecoveryAttempts, 1);
    assert.equal(stats.averageTimeToFirstRecoveryAttempt, '10s');
  });

  test('renders stats in human text box mode when --json is false', async () => {
    let stdoutData = '';
    const context = {
      storage: {
        ledgerDir: '/tmp/fake',
        listRecords: () => ({
          total: 3,
          records: [
            {
              status: 'VERIFIED',
              fingerprint: 'fp12345',
              startTime: '2023-01-01T00:00:00Z',
              recoveryAttempts: [
                {
                  createdAt: '2023-01-01T00:00:05Z',
                  verificationRuns: [{ exitCode: 0 }]
                }
              ]
            },
            { status: 'OPEN', fingerprint: 'fp12345', startTime: '2023-01-01T00:00:00Z' },
            { status: 'FAILED', fingerprint: 'fp67890', startTime: '2023-01-01T00:00:00Z' }
          ]
        })
      },
      parsedArgs: { flags: { json: false } },
      styler: createStyler(false),
      stdout: {
        write: (text) => { stdoutData += text; }
      }
    };

    const exitCode = await statsCommand({ context });
    assert.equal(exitCode, 0);

    assert.match(stdoutData, /Rewind Stats/);
    assert.match(stdoutData, /Total Incidents:\s+3/);
    assert.match(stdoutData, /Verified Fixes:\s+1/);
    assert.match(stdoutData, /Failed Approaches:\s+0/);
    assert.match(stdoutData, /Recovery Attempts:\s+1/);
    assert.match(stdoutData, /Avg Time to 1st Fix:\s+5s/);
    assert.match(stdoutData, /Common Fingerprint:\s+fp12345/);
    assert.match(stdoutData, /Status: OPEN:\s+1/);
    assert.match(stdoutData, /Status: OBSERVED:\s+0/);
  });
});

