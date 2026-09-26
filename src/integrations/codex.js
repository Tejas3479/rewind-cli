import fs from 'node:fs';
import path from 'node:path';

/**
 * Returns Codex hook configuration content.
 *
 * @returns {object}
 */
export function generateCodexConfig() {
  return {
    hooks: {
      PostToolUse: [
        {
          command: 'node scripts/rewind-cursor-hook.js'
        }
      ]
    }
  };
}

/**
 * Installs Codex integration.
 *
 * @param {string} rootDir
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {{ filesCreated: string[] }}
 */
export function installCodexIntegration(rootDir, options = {}) {
  const codexDir = path.join(rootDir, '.codex');
  const hooksPath = path.join(codexDir, 'hooks.json');
  const filesCreated = [];

  if (!options.dryRun) {
    fs.mkdirSync(codexDir, { recursive: true });

    let existing = {};
    if (fs.existsSync(hooksPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      } catch {}
    }

    const merged = {
      ...existing,
      hooks: {
        ...(existing.hooks || {}),
        PostToolUse: [
          {
            command: 'node scripts/rewind-cursor-hook.js'
          }
        ]
      }
    };

    fs.writeFileSync(hooksPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    filesCreated.push(hooksPath);
  } else {
    filesCreated.push(hooksPath);
  }

  return { filesCreated };
}
