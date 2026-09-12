import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { statsCommand } from '../src/commands/stats.js';

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
});
