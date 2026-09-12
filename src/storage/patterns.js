import path from 'node:path';
import { readJournalEvents } from './journal.js';
import { projectEventsToRecords } from './projection.js';
import { IncidentStatus, RecoveryAttemptStatus } from './state.js';

/**
 * Minimum sample size constants for honest evidentiary classifications.
 */
export const MIN_EVIDENCE = {
  RECURRENCE: 2,
  FLAKINESS_RUNS: 3,
  COMPARATIVE_ENV: 3,
  RECOVERY_ATTEMPTS: 2
};

/**
 * Standard classification identifiers.
 */
export const PatternTypes = {
  RECURRING_FAILURE: 'RECURRING_FAILURE',
  RECURRING_REGRESSION: 'RECURRING_REGRESSION',
  LIKELY_FLAKY: 'LIKELY_FLAKY',
  LIKELY_VARIABLE: 'LIKELY_VARIABLE',
  ENVIRONMENT_CORRELATED: 'ENVIRONMENT_CORRELATED',
  RUNTIME_CORRELATED: 'RUNTIME_CORRELATED',
  COMMAND_CORRELATED: 'COMMAND_CORRELATED',
  REPEATED_FAILED_RECOVERY: 'REPEATED_FAILED_RECOVERY',
  FREQUENTLY_VERIFIED_RECOVERY: 'FREQUENTLY_VERIFIED_RECOVERY'
};

/**
 * Evidence strength levels.
 */
export const EvidenceStrength = {
  STRONG: 'STRONG',
  SUPPORTED: 'SUPPORTED',
  LIMITED: 'LIMITED',
  INSUFFICIENT: 'INSUFFICIENT'
};

/**
 * Normalizes a command string and arguments into a stable command identity signature.
 *
 * @param {string} [command='']
 * @param {Array<string>} [args=[]]
 * @returns {string}
 */
export function normalizeCommandIdentity(command = '', args = []) {
  const full = `${command || ''} ${(Array.isArray(args) ? args : []).join(' ')}`.trim();
  return full.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Normalizes a recovery hypothesis text for deterministic matching without NLP/AI.
 *
 * @param {string} [text='']
 * @returns {string}
 */
export function normalizeRecoveryHypothesis(text = '') {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Groups raw journal events into failure families based on the projected records.
 *
 * @param {Array<import('./journal.js').JournalEvent>} events
 * @param {Map<string, import('./record.js').IncidentRecord>} projectedRecords
 * @returns {Map<string, { records: Array<import('./record.js').IncidentRecord>, events: Array<import('./journal.js').JournalEvent> }>}
 */
function groupEventsByFingerprint(events, projectedRecords) {
  const families = new Map();

  for (const record of projectedRecords.values()) {
    const fp = record.fingerprint || 'unknown';
    if (!families.has(fp)) {
      families.set(fp, { records: [], events: [] });
    }
    families.get(fp).records.push(record);
  }

  for (const event of events) {
    const rec = projectedRecords.get(String(event.incidentId));
    const fp = rec?.fingerprint || event.payload?.fingerprint;
    if (fp && families.has(fp)) {
      families.get(fp).events.push(event);
    }
  }

  // Sort records numerically by ID ascending within each family
  for (const family of families.values()) {
    family.records.sort((a, b) => Number(a.id) - Number(b.id));
  }

  return families;
}

/**
 * Analyzes a single failure family against deterministic evidentiary pattern rules.
 *
 * @param {string} fingerprint
 * @param {Array<import('./record.js').IncidentRecord>} records
 * @param {Array<import('./journal.js').JournalEvent>} familyEvents
 * @returns {object}
 */
export function analyzeFamilyPatterns(fingerprint, records, familyEvents) {
  const classifications = [];
  const explanations = [];

  const totalIncidents = records.length;
  const firstRecord = records[0];
  const lastRecord = records[records.length - 1];

  const firstSeen = firstRecord ? (firstRecord.startTime || firstRecord.createdAt || null) : null;
  const lastSeen = lastRecord ? (lastRecord.startTime || lastRecord.createdAt || null) : null;

  // Extract brief error summary from evidence
  const representativeSnippet = firstRecord?.normalizedError ||
    firstRecord?.stderr?.split('\n')[0]?.trim() ||
    `Command failure: ${firstRecord?.fullCommand || 'unknown'}`;

  // ───────────────────────────────────────────────────────────────────────────
  // 1. RECURRING FAILURE RULE
  // ───────────────────────────────────────────────────────────────────────────
  if (totalIncidents >= MIN_EVIDENCE.RECURRENCE) {
    const strength = totalIncidents >= 5 ? EvidenceStrength.STRONG : EvidenceStrength.SUPPORTED;
    classifications.push({
      type: PatternTypes.RECURRING_FAILURE,
      strength,
      summary: `Failure fingerprint observed in ${totalIncidents} independent incidents.`,
      causality: 'NOT PROVEN',
      evidence: {
        totalIncidents,
        firstSeen,
        lastSeen,
        incidentIds: records.map((r) => r.id)
      }
    });

    explanations.push({
      type: PatternTypes.RECURRING_FAILURE,
      title: 'Recurring Failure',
      rule: `Requires >= ${MIN_EVIDENCE.RECURRENCE} independent incidents with identical error fingerprint.`,
      requiredMet: true,
      observed: `${totalIncidents} incidents recorded with fingerprint ${fingerprint}`,
      conclusion: `Classified as ${PatternTypes.RECURRING_FAILURE} (${strength})`,
      causality: 'Identical error signature observed across multiple independent runs. Does not establish root cause.'
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. RECURRING REGRESSION RULE (Authoritative journal derivation)
  // ───────────────────────────────────────────────────────────────────────────
  // A regression is validated if a regression event links to an incident whose recovery was VERIFIED
  const regressionEvents = familyEvents.filter((e) => e.type === 'regression.detected');
  const verifiedIncidents = new Set(
    records
      .filter((r) => r.status === IncidentStatus.RECOVERED || r.recoveryAttempts?.some((a) => a.status === RecoveryAttemptStatus.VERIFIED))
      .map((r) => String(r.id))
  );

  const validatedRegressions = [];
  for (const regEvent of regressionEvents) {
    const parentId = String(regEvent.payload?.regressionOf);
    if (parentId && verifiedIncidents.has(parentId)) {
      validatedRegressions.push({
        incidentId: String(regEvent.incidentId),
        regressionOf: parentId,
        timestamp: regEvent.timestamp
      });
    }
  }

  if (validatedRegressions.length > 0) {
    const strength = validatedRegressions.length >= 2 ? EvidenceStrength.STRONG : EvidenceStrength.SUPPORTED;
    classifications.push({
      type: PatternTypes.RECURRING_REGRESSION,
      strength,
      summary: `Failure recurred ${validatedRegressions.length} time(s) after prior verified resolution.`,
      causality: 'NOT PROVEN',
      evidence: {
        regressionsCount: validatedRegressions.length,
        links: validatedRegressions
      }
    });

    explanations.push({
      type: PatternTypes.RECURRING_REGRESSION,
      title: 'Recurring Regression',
      rule: 'Requires at least 1 regression event explicitly linking back to a previously VERIFIED incident.',
      requiredMet: true,
      observed: `${validatedRegressions.length} regression event(s) validated against verified parent incidents.`,
      conclusion: `Classified as ${PatternTypes.RECURRING_REGRESSION} (${strength})`,
      causality: 'Verified remedy was previously established, but identical failure signature recurred in subsequent execution.'
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. FLAKINESS VS. VARIABILITY RULE (Normalized command + commit + runs)
  // ───────────────────────────────────────────────────────────────────────────
  // Group verification runs & executions by commit + commandIdentity + platform + nodeMajor
  const executionGroups = new Map();

  for (const rec of records) {
    const commit = rec.git?.headCommit || 'unversioned';
    const cmdId = normalizeCommandIdentity(rec.command, rec.args);
    const plat = rec.environment?.platform || 'unknown';
    const nodeMaj = rec.environment?.nodeMajor || 'unknown';

    const groupKey = `${commit}::${cmdId}::${plat}::${nodeMaj}`;
    if (!executionGroups.has(groupKey)) {
      executionGroups.set(groupKey, {
        commit,
        cmdId,
        platform: plat,
        nodeMajor: nodeMaj,
        failures: 0,
        passes: 0,
        total: 0,
        incidents: []
      });
    }

    const group = executionGroups.get(groupKey);
    group.failures += 1;
    group.total += 1;
    group.incidents.push(rec.id);

    // Verification runs are explicitly excluded from flakiness scoring
    // to prevent verification failures from artificially inflating the flakiness heuristic.
  }

  let flakyDetected = false;
  for (const group of executionGroups.values()) {
    if (group.total >= MIN_EVIDENCE.FLAKINESS_RUNS) {
      if (group.passes > 0 && group.failures > 0) {
        flakyDetected = true;
        const passRate = Math.round((group.passes / group.total) * 100);
        classifications.push({
          type: PatternTypes.LIKELY_FLAKY,
          strength: group.total >= 5 ? EvidenceStrength.STRONG : EvidenceStrength.SUPPORTED,
          summary: `Alternating pass/fail outcomes (${group.passes} pass, ${group.failures} fail) under identical commit (${group.commit.slice(0, 7)}) and environment.`,
          causality: 'NOT PROVEN',
          evidence: {
            commit: group.commit,
            command: group.cmdId,
            platform: group.platform,
            nodeMajor: group.nodeMajor,
            totalRuns: group.total,
            passes: group.passes,
            failures: group.failures,
            passRatePercent: passRate
          }
        });

        explanations.push({
          type: PatternTypes.LIKELY_FLAKY,
          title: 'Likely Flaky Failure',
          rule: `Requires >= ${MIN_EVIDENCE.FLAKINESS_RUNS} runs under identical commit, command identity, OS, and Node runtime with both passes and failures.`,
          requiredMet: true,
          observed: `${group.total} runs on commit ${group.commit.slice(0, 7)}: ${group.passes} passed, ${group.failures} failed (${passRate}% pass rate)`,
          conclusion: `Classified as ${PatternTypes.LIKELY_FLAKY}`,
          causality: 'Non-deterministic outcomes observed under identical code and environment conditions. Causality (timing, race, external service) is NOT PROVEN.'
        });
      }
    }
  }

  // If there are multiple failures across different commits or environments but flakiness could not be proven
  if (!flakyDetected && totalIncidents >= 2) {
    const distinctCommits = new Set(records.map((r) => r.git?.headCommit).filter(Boolean));
    const distinctPlatforms = new Set(records.map((r) => r.environment?.platform).filter(Boolean));

    if (distinctCommits.size > 1 || distinctPlatforms.size > 1) {
      classifications.push({
        type: PatternTypes.LIKELY_VARIABLE,
        strength: EvidenceStrength.LIMITED,
        summary: `Failure observed across ${distinctCommits.size} commit(s) and ${distinctPlatforms.size} platform(s) without conclusive flakiness proof.`,
        causality: 'NOT PROVEN',
        evidence: {
          commits: Array.from(distinctCommits),
          platforms: Array.from(distinctPlatforms)
        }
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. ENVIRONMENT CORRELATION (Comparative Exposure Required)
  // ───────────────────────────────────────────────────────────────────────────
  const platformCounts = {};
  for (const rec of records) {
    const plat = rec.environment?.platform || 'unknown';
    platformCounts[plat] = (platformCounts[plat] || 0) + 1;
  }

  const platformsPresent = Object.keys(platformCounts);
  if (platformsPresent.length >= 2) {
    // We have comparative exposure across multiple platforms
    const totalWithPlat = Object.values(platformCounts).reduce((a, b) => a + b, 0);
    for (const [plat, count] of Object.entries(platformCounts)) {
      if (count >= MIN_EVIDENCE.COMPARATIVE_ENV && (count / totalWithPlat) >= 0.75) {
        classifications.push({
          type: PatternTypes.ENVIRONMENT_CORRELATED,
          strength: EvidenceStrength.SUPPORTED,
          summary: `Failure heavily correlated with platform '${plat}' (${count}/${totalWithPlat} incidents) across multi-platform observations.`,
          causality: 'NOT PROVEN',
          evidence: {
            correlatedPlatform: plat,
            distribution: platformCounts,
            totalIncidents: totalWithPlat
          }
        });

        explanations.push({
          type: PatternTypes.ENVIRONMENT_CORRELATED,
          title: 'Environment Correlated',
          rule: `Requires multi-platform comparative exposure with >= ${MIN_EVIDENCE.COMPARATIVE_ENV} observations and >= 75% correlation to a specific platform.`,
          requiredMet: true,
          observed: `Platform distribution: ${JSON.stringify(platformCounts)}`,
          conclusion: `Classified as ${PatternTypes.ENVIRONMENT_CORRELATED} on ${plat}`,
          causality: `Failures observed predominantly on ${plat} when multiple platforms were tested. Causality NOT PROVEN.`
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. RUNTIME CORRELATION (Comparative Exposure Required)
  // ───────────────────────────────────────────────────────────────────────────
  const nodeVersionCounts = {};
  for (const rec of records) {
    const v = rec.environment?.nodeMajor ? String(rec.environment.nodeMajor) : 'unknown';
    nodeVersionCounts[v] = (nodeVersionCounts[v] || 0) + 1;
  }

  const runtimesPresent = Object.keys(nodeVersionCounts);
  if (runtimesPresent.length >= 2) {
    const totalWithRuntime = Object.values(nodeVersionCounts).reduce((a, b) => a + b, 0);
    for (const [nodeVer, count] of Object.entries(nodeVersionCounts)) {
      if (count >= MIN_EVIDENCE.COMPARATIVE_ENV && (count / totalWithRuntime) >= 0.75) {
        classifications.push({
          type: PatternTypes.RUNTIME_CORRELATED,
          strength: EvidenceStrength.SUPPORTED,
          summary: `Failure correlated with Node.js v${nodeVer} (${count}/${totalWithRuntime} incidents) across multi-runtime observations.`,
          causality: 'NOT PROVEN',
          evidence: {
            correlatedNodeMajor: nodeVer,
            distribution: nodeVersionCounts,
            totalIncidents: totalWithRuntime
          }
        });

        explanations.push({
          type: PatternTypes.RUNTIME_CORRELATED,
          title: 'Runtime Correlated',
          rule: `Requires multi-runtime comparative exposure with >= ${MIN_EVIDENCE.COMPARATIVE_ENV} observations and >= 75% correlation.`,
          requiredMet: true,
          observed: `Runtime distribution: ${JSON.stringify(nodeVersionCounts)}`,
          conclusion: `Classified as ${PatternTypes.RUNTIME_CORRELATED} on Node v${nodeVer}`,
          causality: `Failures observed predominantly on Node v${nodeVer} during multi-runtime testing. Causality NOT PROVEN.`
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6. COMMAND CORRELATION (Observation vs. Causality)
  // ───────────────────────────────────────────────────────────────────────────
  const commandCounts = {};
  for (const rec of records) {
    const cmdId = normalizeCommandIdentity(rec.command, rec.args);
    commandCounts[cmdId] = (commandCounts[cmdId] || 0) + 1;
  }

  const distinctCmds = Object.keys(commandCounts);
  if (distinctCmds.length === 1 && totalIncidents >= MIN_EVIDENCE.RECURRENCE) {
    const onlyCmd = distinctCmds[0];
    classifications.push({
      type: PatternTypes.COMMAND_CORRELATED,
      strength: EvidenceStrength.SUPPORTED,
      summary: `Failure family has only been observed through command '${onlyCmd}' (${totalIncidents}/${totalIncidents} incidents).`,
      causality: 'NOT PROVEN',
      evidence: {
        commandIdentity: onlyCmd,
        occurrences: totalIncidents
      }
    });

    explanations.push({
      type: PatternTypes.COMMAND_CORRELATED,
      title: 'Command Correlated',
      rule: `Requires 100% of failure family occurrences (>= ${MIN_EVIDENCE.RECURRENCE}) to originate from a single command identity.`,
      requiredMet: true,
      observed: `All ${totalIncidents} incident(s) executed command '${onlyCmd}'`,
      conclusion: `Classified as ${PatternTypes.COMMAND_CORRELATED}`,
      causality: 'Failure signature has exclusively appeared when running this command. Does not prove the command itself is flawed.'
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. RECOVERY PATTERNS: REPEATED FAILED & FREQUENTLY VERIFIED
  // ───────────────────────────────────────────────────────────────────────────
  const hypothesisStats = new Map();

  for (const rec of records) {
    if (Array.isArray(rec.recoveryAttempts)) {
      for (const attempt of rec.recoveryAttempts) {
        const rawHypothesis = attempt.change || attempt.cause || '';
        const normalized = normalizeRecoveryHypothesis(rawHypothesis);
        if (!normalized) continue;

        if (!hypothesisStats.has(normalized)) {
          hypothesisStats.set(normalized, {
            normalized,
            sampleRaw: rawHypothesis,
            verifyCmd: attempt.verifyCmd || null,
            totalAttempts: 0,
            verifiedCount: 0,
            failedCount: 0,
            incidentIds: new Set()
          });
        }

        const stat = hypothesisStats.get(normalized);
        stat.totalAttempts += 1;
        stat.incidentIds.add(rec.id);
        if (attempt.status === RecoveryAttemptStatus.VERIFIED) {
          stat.verifiedCount += 1;
        } else if (attempt.status === RecoveryAttemptStatus.FAILED) {
          stat.failedCount += 1;
        }
      }
    }
  }

  for (const stat of hypothesisStats.values()) {
    // Repeated Failed Recovery Rule
    if (stat.failedCount >= MIN_EVIDENCE.RECOVERY_ATTEMPTS) {
      classifications.push({
        type: PatternTypes.REPEATED_FAILED_RECOVERY,
        strength: stat.failedCount >= 3 ? EvidenceStrength.STRONG : EvidenceStrength.SUPPORTED,
        summary: `Recovery hypothesis '${stat.sampleRaw}' failed verification in ${stat.failedCount} separate attempt(s).`,
        causality: 'NOT PROVEN',
        evidence: {
          hypothesis: stat.sampleRaw,
          failedAttempts: stat.failedCount,
          totalAttempts: stat.totalAttempts,
          incidents: Array.from(stat.incidentIds)
        }
      });

      explanations.push({
        type: PatternTypes.REPEATED_FAILED_RECOVERY,
        title: 'Repeated Failed Recovery',
        rule: `Requires >= ${MIN_EVIDENCE.RECOVERY_ATTEMPTS} failed verification attempts with equivalent normalized hypothesis.`,
        requiredMet: true,
        observed: `${stat.failedCount} failed attempts recorded across incidents [${Array.from(stat.incidentIds).join(', ')}]`,
        conclusion: `Classified as ${PatternTypes.REPEATED_FAILED_RECOVERY}`,
        causality: 'This specific remediation approach consistently failed verification under recorded conditions.'
      });
    }

    // Frequently Verified Recovery Rule
    if (stat.verifiedCount >= MIN_EVIDENCE.RECOVERY_ATTEMPTS) {
      const rate = Math.round((stat.verifiedCount / stat.totalAttempts) * 100);
      classifications.push({
        type: PatternTypes.FREQUENTLY_VERIFIED_RECOVERY,
        strength: stat.verifiedCount >= 3 ? EvidenceStrength.STRONG : EvidenceStrength.SUPPORTED,
        summary: `Remedy '${stat.sampleRaw}' has been successfully verified in ${stat.verifiedCount} attempt(s) (${rate}% historical verification rate).`,
        causality: 'NOT PROVEN',
        evidence: {
          verifiedRemedy: stat.sampleRaw,
          verifyCommand: stat.verifyCmd,
          verifiedCount: stat.verifiedCount,
          totalAttempts: stat.totalAttempts,
          verificationRatePercent: rate,
          incidents: Array.from(stat.incidentIds)
        }
      });

      explanations.push({
        type: PatternTypes.FREQUENTLY_VERIFIED_RECOVERY,
        title: 'Frequently Verified Recovery',
        rule: `Requires >= ${MIN_EVIDENCE.RECOVERY_ATTEMPTS} successful verifications with equivalent normalized hypothesis.`,
        requiredMet: true,
        observed: `${stat.verifiedCount}/${stat.totalAttempts} verification runs succeeded (${rate}% historical verification rate)`,
        conclusion: `Classified as ${PatternTypes.FREQUENTLY_VERIFIED_RECOVERY}`,
        causality: 'Remedy was repeatedly verified across independent incidents. Historical verification rate is evidentiary, not guaranteed future success.'
      });
    }
  }

  return {
    fingerprint,
    summary: representativeSnippet,
    totalIncidents,
    firstSeen,
    lastSeen,
    classifications,
    explanations,
    incidents: records.map((r) => r.id)
  };
}

/**
 * Analyzes all events from the authoritative journal to generate a complete pattern intelligence report.
 *
 * @param {string} ledgerDir - Path to .rewind directory
 * @param {object} [options={}]
 * @param {string} [options.fingerprint] - Filter report to a specific fingerprint
 * @param {number} [options.limit] - Limit number of pattern families returned
 * @returns {object} PatternReport
 */
export function analyzePatternsFromJournal(ledgerDir, options = {}) {
  // 1. Read authoritative journal events
  const journalPath = ledgerDir.endsWith('journal.jsonl')
    ? ledgerDir
    : path.join(ledgerDir, 'journal.jsonl');
  const { events = [] } = readJournalEvents(journalPath);

  // 2. Derive canonical projected records from event replay
  const projectedRecords = projectEventsToRecords(events);

  return analyzePatternsFromEvents(events, projectedRecords, options);
}

/**
 * Analyzes pre-parsed journal events and projected records to generate a complete pattern
 * intelligence report. This variant avoids redundant disk reads when the caller
 * (e.g. buildAgentContext) has already read the journal.
 *
 * @param {Array<object>} events - Pre-parsed journal events
 * @param {Map<string, object>} projectedRecords - Pre-computed projected records
 * @param {object} [options={}]
 * @param {string} [options.fingerprint] - Filter report to a specific fingerprint
 * @param {number} [options.limit] - Limit number of pattern families returned
 * @returns {object} PatternReport
 */
export function analyzePatternsFromEvents(events, projectedRecords, options = {}) {
  // 1. Group by failure fingerprint
  const families = groupEventsByFingerprint(events, projectedRecords);

  const patternReports = [];
  for (const [fp, familyData] of families.entries()) {
    if (options.fingerprint && !fp.toLowerCase().startsWith(options.fingerprint.toLowerCase())) {
      continue;
    }
    const report = analyzeFamilyPatterns(fp, familyData.records, familyData.events);
    patternReports.push(report);
  }

  // Deterministic sorting: highest incident count first, then lexicographical fingerprint tie-breaker
  patternReports.sort((a, b) => {
    if (b.totalIncidents !== a.totalIncidents) {
      return b.totalIncidents - a.totalIncidents;
    }
    return a.fingerprint.localeCompare(b.fingerprint);
  });

  const finalReports = typeof options.limit === 'number' && options.limit > 0
    ? patternReports.slice(0, options.limit)
    : patternReports;

  // Aggregate metrics
  const totalAnalyzed = events.length;
  const uniqueFamilies = families.size;
  const totalClassifications = finalReports.reduce((acc, r) => acc + r.classifications.length, 0);

  return {
    analyzedEvents: totalAnalyzed,
    uniqueFingerprints: uniqueFamilies,
    patternFamiliesCount: finalReports.length,
    totalClassifications,
    patterns: finalReports
  };
}

