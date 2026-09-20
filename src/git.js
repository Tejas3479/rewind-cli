import fs from 'node:fs';
import path from 'node:path';

/**
 * Git metadata structure.
 * @typedef {object} GitMetadata
 * @property {boolean} isGit - Whether a git repository structure was detected
 * @property {string|null} gitDir - Absolute path to the resolved .git directory
 * @property {string|null} headCommit - 40-character SHA of current HEAD commit
 * @property {string|null} ref - Current symbolic ref (e.g. "refs/heads/main")
 * @property {string|null} branch - Current branch name (e.g. "main")
 * @property {boolean} detached - Whether repository is in detached HEAD state
 * @property {string} workingTreeState - Explicitly "unverified" without external git binary calls
 */

/**
 * Finds the .git location by searching upward from a starting directory.
 * Supports both standard .git directories and .git file pointers (worktrees/submodules).
 *
 * @param {string} [startDir=process.cwd()]
 * @returns {string|null} - Absolute path to git directory or null if not in a repo
 */
export function findGitDir(startDir = process.cwd()) {
  let current = path.resolve(startDir);

  while (true) {
    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) {
      try {
        const stat = fs.statSync(gitPath);
        if (stat.isDirectory()) {
          return gitPath;
        }
        if (stat.isFile()) {
          // Worktree or submodule pointer: "gitdir: <path>"
          const content = fs.readFileSync(gitPath, 'utf8').trim();
          const match = content.match(/^gitdir:\s*(.+)$/i);
          if (match && match[1]) {
            const target = match[1].trim();
            return path.isAbsolute(target) ? target : path.resolve(current, target);
          }
        }
      } catch {
        // Unreadable, continue search
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

/**
 * Parses packed-refs file to find the commit SHA for a given ref.
 *
 * @param {string} gitDir
 * @param {string} targetRef
 * @returns {string|null}
 */
function resolvePackedRef(gitDir, targetRef) {
  const packedRefsPath = path.join(gitDir, 'packed-refs');
  if (!fs.existsSync(packedRefsPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(packedRefsPath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('^')) {
        continue;
      }
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2 && parts[1] === targetRef) {
        return parts[0];
      }
    }
  } catch {
    // If unreadable, return null
  }
  return null;
}

/**
 * Reads Git repository metadata directly from the filesystem without invoking
 * git or any external processes.
 *
 * @param {string} [startDir=process.cwd()]
 * @returns {GitMetadata}
 */
export function readGitMetadata(startDir = process.cwd()) {
  const fallback = {
    isGit: false,
    gitDir: null,
    headCommit: null,
    ref: null,
    branch: null,
    detached: false,
    workingTreeState: 'unverified'
  };

  const gitDir = findGitDir(startDir);
  if (!gitDir) {
    return fallback;
  }

  const headPath = path.join(gitDir, 'HEAD');
  if (!fs.existsSync(headPath)) {
    return { ...fallback, isGit: true, gitDir };
  }

  try {
    const headContent = fs.readFileSync(headPath, 'utf8').trim();

    // Case 1: Symbolic reference (e.g. "ref: refs/heads/main")
    if (headContent.startsWith('ref:')) {
      const ref = headContent.slice(4).trim();
      const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;

      let commit = null;
      const refFilePath = path.join(gitDir, ref);

      // Check loose ref file
      if (fs.existsSync(refFilePath)) {
        try {
          commit = fs.readFileSync(refFilePath, 'utf8').trim();
        } catch {
          commit = null;
        }
      }

      // If loose ref not present, check packed-refs
      if (!commit || (commit.length !== 40 && commit.length !== 64)) {
        commit = resolvePackedRef(gitDir, ref);
      }

      return {
        isGit: true,
        gitDir,
        headCommit: commit && /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(commit) ? commit : null,
        ref,
        branch,
        detached: false,
        workingTreeState: 'unverified'
      };
    }

    // Case 2: Detached HEAD (direct 40-character SHA)
    if (/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(headContent)) {
      return {
        isGit: true,
        gitDir,
        headCommit: headContent,
        ref: null,
        branch: null,
        detached: true,
        workingTreeState: 'unverified'
      };
    }

    return {
      isGit: true,
      gitDir,
      headCommit: null,
      ref: null,
      branch: null,
      detached: false,
      workingTreeState: 'unverified'
    };
  } catch {
    return { ...fallback, isGit: true, gitDir };
  }
}
