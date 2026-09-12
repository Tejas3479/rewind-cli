import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildStandaloneArtifact, runReproducibleBuild } from '../scripts/build.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distFile = path.join(rootDir, 'dist', 'rewind.js');

describe('Reproducible Build Engine (scripts/build.js)', () => {
  it('produces byte-identical SHA-256 hashes across independent build passes', () => {
    const pass1 = buildStandaloneArtifact();
    const pass2 = buildStandaloneArtifact();
    const pass3 = buildStandaloneArtifact();

    assert.ok(pass1.hash, "Build pass 1 must have a SHA-256 hash");
    assert.equal(pass1.hash, pass2.hash, "Pass 1 and Pass 2 must be byte-identical");
    assert.equal(pass2.hash, pass3.hash, "Pass 2 and Pass 3 must be byte-identical");
    assert.equal(pass1.size, pass2.size, "Pass 1 and Pass 2 sizes must be identical");
    assert.equal(pass1.content, pass2.content, "Pass 1 and Pass 2 content must be identical");
  });

  it('runReproducibleBuild writes standalone executable artifact to dist/rewind.js', () => {
    const result = runReproducibleBuild();
    assert.ok(fs.existsSync(distFile), "dist/rewind.js must exist on disk");

    const fileContent = fs.readFileSync(distFile, "utf8");
    assert.equal(fileContent, result.content, "Written file must match build content");
  });

  it('standalone artifact executes --version with exact output', () => {
    const output = execSync(`node "${distFile}" --version`, { encoding: "utf8" }).trim();
    assert.equal(output, "rewind v1.0.0");
  });

  it('standalone artifact executes help command cleanly', () => {
    const output = execSync(`node "${distFile}" help`, { encoding: "utf8" }).trim();
    assert.ok(output.includes("REWIND — Remember what fixed it."), "Help output must contain project title");
    assert.ok(output.includes("CORE WORKFLOW:"), "Help output must contain core workflow");
  });
});