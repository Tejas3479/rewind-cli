/**
 * Zero-dependency Myers diff and Unified Diff implementation.
 * Replaces the 'diff' and 'fast-diff' npm packages (50M+ weekly downloads).
 *
 * Implements Longest Common Subsequence (LCS) / Myers Diff algorithm
 * for line-by-line and word-by-word structural comparison.
 */

/**
 * Computes the Longest Common Subsequence matrix between two token arrays.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number[][]}
 */
function computeLcsMatrix(a, b) {
  const m = a.length;
  const n = b.length;
  const matrix = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
      }
    }
  }
  return matrix;
}

/**
 * Backtracks the LCS matrix to produce a linear list of additions, deletions, and unchanged items.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @param {number[][]} matrix
 * @returns {Array<{ type: "added"|"removed"|"unchanged", value: string }>}
 */
function backtrackLcs(a, b, matrix) {
  let i = a.length;
  let j = b.length;
  const result = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: 'unchanged', value: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
      result.push({ type: 'added', value: b[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
      result.push({ type: 'removed', value: a[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Computes line-by-line diff between two strings.
 *
 * @param {string} [oldText=""]
 * @param {string} [newText=""]
 * @returns {Array<{ type: "added"|"removed"|"unchanged", value: string }>}
 */
export function diffLines(oldText = "", newText = "") {
  if (oldText === newText) {
    if (!oldText) return [];
    return oldText.split('\n').map((line) => ({ type: 'unchanged', value: line }));
  }

  const aLines = oldText === '' ? [] : oldText.split('\n');
  const bLines = newText === '' ? [] : newText.split('\n');

  if (aLines.length * bLines.length > 10_000_000) {
    return [
      ...aLines.map(line => ({ type: 'removed', value: line })),
      ...bLines.map(line => ({ type: 'added', value: line }))
    ];
  }

  const matrix = computeLcsMatrix(aLines, bLines);
  return backtrackLcs(aLines, bLines, matrix);
}

/**
 * Computes word-by-word diff between two strings.
 *
 * @param {string} [oldText=""]
 * @param {string} [newText=""]
 * @returns {Array<{ type: "added"|"removed"|"unchanged", value: string }>}
 */
export function diffWords(oldText = "", newText = "") {
  if (oldText === newText) {
    if (!oldText) return [];
    return [{ type: 'unchanged', value: oldText }];
  }

  const tokenize = (str) => str.match(/\w+|[^\s\w]+|\s+/g) || [];
  const aWords = tokenize(oldText);
  const bWords = tokenize(newText);

  if (aWords.length * bWords.length > 10_000_000) {
    return [
      ...aWords.map(word => ({ type: 'removed', value: word })),
      ...bWords.map(word => ({ type: 'added', value: word }))
    ];
  }

  const matrix = computeLcsMatrix(aWords, bWords);
  return backtrackLcs(aWords, bWords, matrix);
}

/**
 * Formats line diffs into standard Unified Diff format (git-compatible).
 *
 * @param {string} oldFileName
 * @param {string} newFileName
 * @param {string} [oldText=""]
 * @param {string} [newText=""]
 * @param {object} [options={}]
 * @param {number} [options.contextLines=3]
 * @returns {string}
 */
export function createUnifiedDiff(oldFileName, newFileName, oldText = "", newText = "", options = {}) {
  const contextLines = typeof options.contextLines === 'number' ? options.contextLines : 3;
  const changes = diffLines(oldText, newText);

  if (changes.every((c) => c.type === 'unchanged')) {
    return '';
  }

  const hunks = [];
  let currentHunk = null;
  let oldLineNum = 1;
  let newLineNum = 1;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const isChange = change.type !== 'unchanged';

    if (isChange) {
      if (!currentHunk) {
        const contextStart = Math.max(0, i - contextLines);
        currentHunk = {
          oldStart: Math.max(1, oldLineNum - (i - contextStart)),
          newStart: Math.max(1, newLineNum - (i - contextStart)),
          lines: []
        };
        for (let c = contextStart; c < i; c++) {
          currentHunk.lines.push({ type: ' ', value: changes[c].value });
        }
      }

      if (change.type === 'removed') {
        currentHunk.lines.push({ type: '-', value: change.value });
      } else if (change.type === 'added') {
        currentHunk.lines.push({ type: '+', value: change.value });
      }
    } else if (currentHunk) {
      currentHunk.lines.push({ type: ' ', value: change.value });

      const trailingContextCount = currentHunk.lines
        .slice()
        .reverse()
        .findIndex((l) => l.type !== ' ');

      if (trailingContextCount >= contextLines) {
        const nextChangeIndex = changes.slice(i + 1, i + 1 + contextLines).findIndex((c) => c.type !== 'unchanged');
        if (nextChangeIndex === -1) {
          currentHunk.lines = currentHunk.lines.slice(0, currentHunk.lines.length - (trailingContextCount - contextLines));
          hunks.push(currentHunk);
          currentHunk = null;
        }
      }
    }

    if (change.type === 'removed' || change.type === 'unchanged') oldLineNum++;
    if (change.type === 'added' || change.type === 'unchanged') newLineNum++;
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  if (hunks.length === 0) return '';

  const header = [`--- ${oldFileName}`, `+++ ${newFileName}`];
  const output = [...header];

  for (const hunk of hunks) {
    const oldCount = hunk.lines.filter((l) => l.type === ' ' || l.type === '-').length;
    const newCount = hunk.lines.filter((l) => l.type === ' ' || l.type === '+').length;
    const hunkHeader = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
    output.push(hunkHeader);
    for (const line of hunk.lines) {
      output.push(`${line.type}${line.value}`);
    }
  }

  return output.join('\n');
}

/**
 * Formats a unified diff string with ANSI terminal color codes.
 *
 * @param {string} [unifiedDiff=""]
 * @param {import("./formatter.js").createStyler} [styler=null]
 * @returns {string}
 */
export function formatColorDiff(unifiedDiff = "", styler = null) {
  if (!unifiedDiff) return '';
  if (!styler || !styler.enabled) return unifiedDiff;

  const lines = unifiedDiff.split('\n');
  return lines
    .map((line) => {
      if (line.startsWith('---') || line.startsWith('+++')) {
        return styler.bold(line);
      }
      if (line.startsWith('@@')) {
        return styler.cyan(line);
      }
      if (line.startsWith('+')) {
        return styler.green(line);
      }
      if (line.startsWith('-')) {
        return styler.red(line);
      }
      return styler.dim(line);
    })
    .join('\n');
}
