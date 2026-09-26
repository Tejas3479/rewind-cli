import { IncidentStatus } from './state.js';
import { extractNegativeMemory } from './negative_memory.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'is', 'for', 'and', 'or', 'it', 'by', 'with', 'from', 'as', 'be', 'this', 'that'
]);

const ERROR_SYNONYMS = {
  'eacces': ['permission', 'denied'],
  'enoent': ['not', 'found'],
  'econnrefused': ['connection', 'refused'],
  'eaddrinuse': ['port', 'in', 'use'],
  'enospc': ['no', 'space', 'left', 'on', 'device'],
  'etimedout': ['timed', 'out', 'timeout'],
  'eexist': ['file', 'exists'],
  'eisdir': ['is', 'a', 'directory'],
  'enotdir': ['not', 'a', 'directory']
};

/**
 * Calculates Levenshtein distance between two strings.
 * Zero dependencies.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Tokenizes text into a unique set of normalized lowercase terms, expanding synonyms.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function extractTokens(text) {
  if (!text || typeof text !== 'string') return new Set();
  const rawWords = text.toLowerCase().split(/[^a-z0-9_.-]+/);
  const tokens = new Set();

  for (const word of rawWords) {
    const clean = word.replace(/^[._-]+|[._-]+$/g, '');
    if (clean.length >= 2 && !STOP_WORDS.has(clean)) {
      tokens.add(clean);
      if (ERROR_SYNONYMS[clean]) {
        for (const syn of ERROR_SYNONYMS[clean]) {
          tokens.add(syn);
        }
      }
    }
  }

  // Also check reverse synonyms (e.g. text contains "permission" and "denied" -> add "eacces")
  for (const [errno, syns] of Object.entries(ERROR_SYNONYMS)) {
    if (syns.every(s => tokens.has(s))) {
      tokens.add(errno);
    }
  }

  return tokens;
}


/**
 * @typedef {object} SearchMatch
 * @property {string} id - Incident ID
 * @property {number} score - Similarity score in [0.0, 1.0]
 * @property {'EXACT_MATCH'|'SIMILAR_MATCH'} matchType - Strict match taxonomy
 * @property {'VERIFIED'|'LIKELY'|'NOT PROVEN'} confidence - Evidence confidence
 * @property {string} status - Incident trust loop status
 * @property {string} reason - Inspectable explanation for similarity score
 * @property {string[]} matchedTokens - Tokens from query matching the record
 * @property {number} failedAttemptsCount - Number of failed recovery attempts
 * @property {import('./record.js').IncidentRecord} record - The full incident record
 */

/**
 * Scores a single record against a search query using a transparent, deterministic multi-factor model.
 *
 * @param {string} query
 * @param {import('./record.js').IncidentRecord} record
 * @param {object} [context={}]
 * @param {string} [context.cleanQuery]
 * @param {Set<string>} [context.queryTokens]
 * @returns {SearchMatch}
 */
export function scoreRecord(query, record, context = {}) {
  const cleanQuery = context.cleanQuery || query.trim().toLowerCase();
  const fp = (record.fingerprint || '').toLowerCase();
  const isRecovered = record.status === IncidentStatus.RECOVERED || record.status === 'VERIFIED';

  // 1. Tier 1: Exact Fingerprint Match (supports modern 64-hex, legacy 16-hex, and prefixes)
  const isExactFp = Boolean(fp && (
    cleanQuery === fp ||
    fp.startsWith(cleanQuery) ||
    cleanQuery.includes(fp) ||
    (cleanQuery.length === 64 && fp.length === 16 && cleanQuery.startsWith(fp))
  ));

  if (isExactFp) {
    const failedAttempts = extractNegativeMemory([record]);
    return {
      id: record.id,
      score: 1.0,
      matchType: 'EXACT_MATCH',
      confidence: isRecovered ? 'VERIFIED' : 'LIKELY',
      status: record.status,
      reason: isRecovered
        ? 'Exact fingerprint match — verified recovery exists under recorded conditions'
        : 'Exact fingerprint match — historical evidence exists but fix is not yet verified',
      matchedTokens: [fp],
      failedAttemptsCount: failedAttempts.length,
      record
    };
  }

  const queryTokens = context.queryTokens || extractTokens(cleanQuery);
  if (queryTokens.size === 0) {
    return {
      id: record.id,
      score: 0.0,
      matchType: 'SIMILAR_MATCH',
      confidence: 'NOT PROVEN',
      status: record.status,
      reason: 'Empty or non-distinctive search query',
      matchedTokens: [],
      failedAttemptsCount: 0,
      record
    };
  }

  const errorText = `${record.normalizedError || ''} ${record.stderr || ''}`.toLowerCase();
  const cmdText = `${record.fullCommand || ''} ${record.command || ''} ${(record.args || []).join(' ')}`.toLowerCase();

  const recoveryParts = [];
  if (Array.isArray(record.recoveryAttempts)) {
    for (const attempt of record.recoveryAttempts) {
      if (attempt.cause) recoveryParts.push(attempt.cause);
      if (attempt.change) recoveryParts.push(attempt.change);
      if (attempt.verifyCmd) recoveryParts.push(attempt.verifyCmd);
      if (attempt.notes) recoveryParts.push(attempt.notes);
      if (attempt.observedChanges) recoveryParts.push(attempt.observedChanges);
    }
  }
  if (record.diagnostic?.suggestion) recoveryParts.push(record.diagnostic.suggestion);
  if (record.diagnostic?.summary) recoveryParts.push(record.diagnostic.summary);
  const recoveryText = recoveryParts.join(' ').toLowerCase();

  const errorTokens = extractTokens(errorText);
  const cmdTokens = extractTokens(cmdText);
  const recoveryTokens = extractTokens(recoveryText);

  // Fast token intersection without large object overhead
  const matchedTokens = new Set();
  let matchedInRecovery = false;
  
  const allRecordTokens = new Set([...errorTokens, ...cmdTokens, ...recoveryTokens]);

  for (const token of queryTokens) {
    if (errorTokens.has(token) || cmdTokens.has(token)) {
      matchedTokens.add(token);
    } else if (recoveryTokens.has(token)) {
      matchedTokens.add(token);
      matchedInRecovery = true;
    } else {
      // Small Levenshtein-distance-<=2 matching on unmatched tokens
      for (const rToken of allRecordTokens) {
        if (Math.abs(token.length - rToken.length) <= 2) {
          const distance = levenshtein(token, rToken);
          if (distance <= 2) {
            matchedTokens.add(token); // Add the query token as matched
            if (recoveryTokens.has(rToken)) {
              matchedInRecovery = true;
            }
            break;
          }
        }
      }
    }
  }

  if (matchedTokens.size === 0) {
    return {
      id: record.id,
      score: 0.0,
      matchType: 'SIMILAR_MATCH',
      confidence: 'NOT PROVEN',
      status: record.status,
      reason: 'No matching tokens found',
      matchedTokens: [],
      failedAttemptsCount: 0,
      record
    };
  }

  // Calculate token metrics
  const totalRecordTokens = errorTokens.size + cmdTokens.size + recoveryTokens.size;
  const recall = matchedTokens.size / queryTokens.size;
  const unionSize = queryTokens.size + totalRecordTokens - matchedTokens.size;
  const jaccard = unionSize > 0 ? matchedTokens.size / unionSize : 0;

  // Substring exact phrase match bonus
  let phraseBonus = 0;
  if (cleanQuery.length >= 4 && (errorText.includes(cleanQuery) || cmdText.includes(cleanQuery) || recoveryText.includes(cleanQuery))) {
    phraseBonus = 0.25;
  }

  // Executable name match bonus
  let cmdBonus = 0;
  if (record.command && cleanQuery.includes(record.command.toLowerCase())) {
    cmdBonus = 0.10;
  }

  const rawScore = (recall * 0.55) + (jaccard * 0.20) + phraseBonus + cmdBonus;
  const score = Math.min(1.0, Math.round(rawScore * 100) / 100);

  const failedAttempts = extractNegativeMemory([record]);

  // Determine trust loop confidence:
  // Critical Trust Invariant: Unverified records NEVER have VERIFIED confidence
  let confidence = 'NOT PROVEN';
  if (score >= 0.40 && isRecovered) {
    confidence = 'VERIFIED';
  } else if (score >= 0.35) {
    confidence = 'LIKELY';
  }

  // Generate inspectable reason
  const tokenList = Array.from(matchedTokens).slice(0, 5).join(', ');
  let reason = '';
  if (phraseBonus > 0) {
    if (recoveryText.includes(cleanQuery)) {
      reason = `Exact query phrase match in recovery attempts/fixes (${matchedTokens.size} matching terms: ${tokenList})`;
    } else {
      reason = `Exact query phrase match in failure output (${matchedTokens.size} matching terms: ${tokenList})`;
    }
  } else if (recall >= 0.70) {
    reason = `High token overlap in failure and recovery evidence (${matchedTokens.size}/${queryTokens.size} terms: ${tokenList})`;
  } else if (matchedInRecovery) {
    reason = `Matching terms in historical recovery fixes and notes (${tokenList})`;
  } else {
    reason = `Partial token match across command and error context (${tokenList})`;
  }

  return {
    id: record.id,
    score,
    matchType: 'SIMILAR_MATCH',
    confidence,
    status: record.status,
    reason,
    matchedTokens: Array.from(matchedTokens),
    failedAttemptsCount: failedAttempts.length,
    record
  };
}

/**
 * Searches and ranks ledger records against a query string.
 *
 * @param {string} query
 * @param {Array<import('./record.js').IncidentRecord>} records
 * @param {object} [options]
 * @param {number} [options.minScore=0.15]
 * @param {number} [options.limit]
 * @returns {SearchMatch[]}
 */
export function searchRecords(query, records = [], options = {}) {
  if (!query || typeof query !== 'string' || !records.length) {
    return [];
  }

  const minScore = options.minScore ?? 0.15;
  const cleanQuery = query.trim().toLowerCase();
  const queryTokens = extractTokens(cleanQuery);
  const context = { cleanQuery, queryTokens };

  const matches = [];

  for (const record of records) {
    const match = scoreRecord(query, record, context);
    if (match.score >= minScore) {
      matches.push(match);
    }
  }

  // Deterministic sorting: highest score first, then newest ID first
  matches.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return Number(b.id) - Number(a.id);
  });

  if (options.limit && options.limit > 0) {
    return matches.slice(0, options.limit);
  }

  return matches;
}

