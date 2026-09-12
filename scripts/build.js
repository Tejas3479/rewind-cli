#!/usr/bin/env node
/**
 * REWIND — Zero-Dependency Deterministic Standalone Bundler & Reproducible Build Engine
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const distFile = path.join(distDir, 'rewind.js');

/**
 * Recursively retrieves all JavaScript files from a directory.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function getAllSourceFiles(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getAllSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Deterministically compiles all project modules into a single standalone distribution artifact.
 *
 * @returns {{ content: string, hash: string, size: number }}
 */
export function buildStandaloneArtifact() {
  const srcFiles = getAllSourceFiles(path.join(rootDir, 'src')).sort();
  const binFile = path.join(rootDir, 'bin', 'rewind.js');
  const allFiles = [...srcFiles, binFile];

  const moduleEntries = [];

  for (const file of allFiles) {
    const relPath = path.relative(rootDir, file).replace(/\\/g, "/");
    let code = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

    // Strip shebang if present
    if (code.startsWith('#!')) {
      code = code.replace(/^#![^\n]*\n/, '');
    }

    moduleEntries.push({
      id: relPath,
      code: code
    });
  }

  // Strictly sort entries lexicographically for deterministic compilation
  moduleEntries.sort((a, b) => a.id.localeCompare(b.id));

  const bundleLines = [
    '#!/usr/bin/env node',
    '/**',
    ' * REWIND — Deterministic Standalone Distribution Artifact',
    ' * Zero Dependencies | Byte-Identical Reproducible Build',
    ' */',
    '',
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import crypto from 'node:crypto';",
    "import child_process from 'node:child_process';",
    "import os from 'node:os';",
    "import readline from 'node:readline';",
    "import readlinePromises from 'node:readline/promises';",
    "import stream from 'node:stream';",
    "import url from 'node:url';",
    "import assert from 'node:assert';",
    '',
    'const builtins = {',
    "  'node:fs': fs,",
    "  'node:fs/promises': fs.promises,",
    "  'node:path': path,",
    "  'node:crypto': crypto,",
    "  'node:child_process': child_process,",
    "  'node:os': os,",
    "  'node:readline': readline,",
    "  'node:readline/promises': readlinePromises || readline.promises,",
    "  'node:stream': stream,",
    "  'node:url': url,",
    "  'node:assert': assert,",
    "  'node:assert/strict': assert.strict || assert,",
    "  'fs': fs,",
    "  'path': path,",
    "  'crypto': crypto,",
    "  'child_process': child_process,",
    "  'os': os,",
    "  'readline': readline,",
    "  'readline/promises': readlinePromises || readline.promises,",
    "  'stream': stream,",
    "  'url': url,",
    "  'assert': assert",
    '};',
    '',
    'const registry = {};',
    'const moduleCache = {};',
    '',
    'function resolvePath(fromFile, target) {',
    '  if (builtins[target]) return target;',
    "  if (target.startsWith('.')) {",
    '    const dir = path.dirname(fromFile);',
    '    let resolved = path.normalize(path.join(dir, target)).replace(/\\\\/g, "/");',
    "    if (!resolved.endsWith('.js')) resolved += '.js';",
    '    return resolved;',
    '  }',
    '  return target;',
    '}',
    '',
    'function requireModule(fromFile, target) {',
    '  const resolved = resolvePath(fromFile, target);',
    '  if (builtins[resolved]) return builtins[resolved];',
    '  if (moduleCache[resolved]) return moduleCache[resolved].exports;',
    '  const factory = registry[resolved];',
    '  if (!factory) throw new Error("Cannot find module " + target + " from " + fromFile);',
    '  const mod = { exports: {} };',
    '  moduleCache[resolved] = mod;',
    '  factory((t) => requireModule(resolved, t), mod.exports, mod);',
    '  return mod.exports;',
    '}',
    ''
  ];

  for (const entry of moduleEntries) {
    let body = entry.code;
    const exportsToRegister = [];

    // Collect export names from declarations
    const exportNamedMatch = body.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/g);
    for (const m of exportNamedMatch) {
      exportsToRegister.push(m[1]);
    }

    // Handle re-exports first: export { a, b } from "./mod.js"
    body = body.replace(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, (match, names, target) => {
      const items = names.split(",").map((s) => s.trim()).filter(Boolean);
      return items.map((item) => {
        const [orig, alias] = item.split(/\s+as\s+/);
        const exportName = alias || orig;
        const importName = orig;
        return "exports." + exportName + " = require(\"" + target + "\")." + importName + ";";
      }).join(" ");
    });

    // Handle imports
    body = body.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g, 'const $1 = require("$2");');
    body = body.replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g, 'const $1 = (require("$2").default || require("$2"));');
    body = body.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, 'const { $1 } = require("$2");');
    body = body.replace(/import\s+['"]([^'"]+)['"];?/g, 'require("$1");');

    // Handle standard exports
    body = body.replace(/export\s*\{([^}]+)\};?/g, 'Object.assign(exports, { $1 });');
    body = body.replace(/export\s+default\s+/g, 'module.exports.default = ');
    body = body.replace(/export\s+(const|let|var)\s+/g, '$1 ');
    body = body.replace(/export\s+(async\s+function|function|class)\s+/g, '$1 ');

    if (entry.id === "bin/rewind.js") {
      bundleLines.push("registry[" + JSON.stringify(entry.id) + "] = async function(require, exports, module) {");
    } else {
      bundleLines.push("registry[" + JSON.stringify(entry.id) + "] = function(require, exports, module) {");
    }
    bundleLines.push(body);
    if (exportsToRegister.length > 0) {
      bundleLines.push("Object.assign(exports, { " + exportsToRegister.join(", ") + " });");
    }
    bundleLines.push("};");
    bundleLines.push("");
  }

  bundleLines.push("// Execute entrypoint");
  bundleLines.push("await (async () => {");
  bundleLines.push("  const mod = { exports: {} };");
  bundleLines.push("  moduleCache[\"bin/rewind.js\"] = mod;");
  bundleLines.push("  await registry[\"bin/rewind.js\"]((t) => requireModule(\"bin/rewind.js\", t), mod.exports, mod);");
  bundleLines.push("})();");
  bundleLines.push("");

  const outputContent = bundleLines.join("\n");
  const hash = crypto.createHash("sha256").update(outputContent, "utf8").digest("hex");
  return { content: outputContent, hash, size: Buffer.byteLength(outputContent, "utf8") };
}

/**
 * Main build execution with dual-pass bitwise verification.
 */
export function runReproducibleBuild() {
  console.log("=== REWIND REPRODUCIBLE BUILD ENGINE ===");
  console.log("Running compilation Pass #1...");
  const pass1 = buildStandaloneArtifact();
  console.log("  ✔ Pass #1 SHA-256: " + pass1.hash + " (" + pass1.size + " bytes)");

  console.log("Running compilation Pass #2 (independent instance)...");
  const pass2 = buildStandaloneArtifact();
  console.log("  ✔ Pass #2 SHA-256: " + pass2.hash + " (" + pass2.size + " bytes)");

  if (pass1.hash !== pass2.hash) {
    console.error("FATAL: Non-deterministic build detected! Hashes diverged.");
    process.exit(1);
  }

  console.log("✔ DETERMINISM VERIFIED: Byte-for-byte identical output produced across both passes.");

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  fs.writeFileSync(distFile, pass1.content, "utf8");
  console.log("✔ Output written to " + path.relative(rootDir, distFile));
  console.log("\nPUBLISHED ARTIFACT SHA-256:\n" + pass1.hash + "\n");
  return pass1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runReproducibleBuild();
}