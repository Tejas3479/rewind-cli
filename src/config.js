import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Reads version from package.json at module load time.
 * Falls back to '1.0.0' if package.json cannot be read.
 */
function loadVersion() {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export const DEFAULT_LEDGER_DIR = '.rewind';
export const VERSION = loadVersion();

/**
 * Searches upward from startDir to locate the project root or .rewind directory.
 *
 * Priority:
 * 1. Nearest ancestor containing an existing `.rewind` directory.
 * 2. Nearest ancestor containing a `.git` repository directory.
 * 3. Fallback to startDir.
 *
 * @param {string} startDir - Directory to start searching from
 * @returns {string} - Discovered root path
 */
export function findProjectRoot(startDir = process.cwd()) {
  const normalizedStart = path.resolve(startDir);
  let current = normalizedStart;

  // 1. Search for existing .rewind ledger
  while (true) {
    const rewindDir = path.join(current, DEFAULT_LEDGER_DIR);
    if (fs.existsSync(rewindDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 2. Search for git root marker
  current = normalizedStart;
  while (true) {
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 3. Fallback to startDir
  return normalizedStart;
}

/**
 * Default global settings for the CLI
 */
export const DEFAULT_SETTINGS = {
  defaultLimit: 20,
  colorOutput: true,
  hookShell: 'bash',
  redactPatterns: [],
  maxEvidenceSize: 65536
};

/**
 * Safely loads and parses a JSON config file.
 * Returns empty object if file doesn't exist or is invalid.
 *
 * @param {string} filePath
 * @returns {object}
 */
function loadJsonConfig(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content) || {};
    }
  } catch {
    // Ignore parse or read errors for optional config
  }
  return {};
}

/**
 * Resolves the effective project root, ledger path, and settings given CLI options and environment.
 *
 * @param {object} [options]
 * @param {string|null} [options.cliRoot] - Explicit --root flag
 * @param {Record<string, string>} [options.env=process.env] - Environment variables
 * @param {string} [options.cwd=process.cwd()] - Current working directory
 * @returns {{ rootDir: string, ledgerDir: string, version: string, settings: object }}
 */
export function resolveConfig({ cliRoot = null, env = process.env, cwd = process.cwd() } = {}) {
  let rootDir;

  if (cliRoot) {
    rootDir = path.resolve(cwd, cliRoot);
  } else if (env.REWIND_ROOT) {
    rootDir = path.resolve(cwd, env.REWIND_ROOT);
  } else {
    rootDir = findProjectRoot(cwd);
  }

  const ledgerDir = path.join(rootDir, DEFAULT_LEDGER_DIR);

  // Load configuration files (JSON)
  const homeDir = os.homedir();
  const globalConfig = loadJsonConfig(path.join(homeDir, '.rewindrc'));
  
  const projectRc = loadJsonConfig(path.join(rootDir, '.rewindrc'));
  const projectConfigJson = loadJsonConfig(path.join(rootDir, 'rewind.config.json'));
  const ledgerConfigJson = loadJsonConfig(path.join(ledgerDir, 'config.json'));

  // Merge order: Default -> Global -> Project (.rewindrc -> rewind.config.json) -> Ledger
  const settings = {
    ...DEFAULT_SETTINGS,
    ...globalConfig,
    ...projectRc,
    ...projectConfigJson,
    ...ledgerConfigJson
  };

  return {
    rootDir,
    ledgerDir,
    version: VERSION,
    settings
  };
}
