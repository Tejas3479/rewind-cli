import fs from 'node:fs';
import path from 'node:path';

/**
 * Returns Gemini CLI configuration content.
 *
 * @returns {object}
 */
export function generateGeminiConfig() {
  return {
    hooks: {
      AfterTool: [
        {
          matcher: 'run_command',
          command: 'node scripts/rewind-gemini-hook.js'
        }
      ]
    }
  };
}

/**
 * Installs Gemini CLI integration.
 *
 * @param {string} rootDir
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {{ filesCreated: string[] }}
 */
export function installGeminiIntegration(rootDir, options = {}) {
  const geminiDir = path.join(rootDir, '.gemini');
  const settingsPath = path.join(geminiDir, 'settings.json');
  const filesCreated = [];

  if (!options.dryRun) {
    fs.mkdirSync(geminiDir, { recursive: true });

    let existing = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {}
    }

    const merged = {
      ...existing,
      hooks: {
        ...(existing.hooks || {}),
        AfterTool: [
          {
            matcher: 'run_command',
            command: 'node scripts/rewind-cursor-hook.js'
          }
        ]
      }
    };

    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    filesCreated.push(settingsPath);
  } else {
    filesCreated.push(settingsPath);
  }

  return { filesCreated };
}
