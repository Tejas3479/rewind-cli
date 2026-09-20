
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const proofFile = path.join(rootDir, "DEPENDENCY_PROOF.md");

console.log("Running test suite to extract metrics...");
let testOutput = "";
try {
  testOutput = execSync("node --test", { cwd: rootDir, encoding: "utf8" });
} catch (err) {
  testOutput = err.stdout || "";
}

// Extract the counts from the bottom of the TAP output
const metrics = {};
const lines = testOutput.split("\n");
for (const line of lines) {
  const match = line.match(/^# (tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)$/);
  if (match) {
    metrics[match[1]] = match[2];
  }
}

if (!metrics.tests) {
  console.error("Failed to parse test metrics from TAP output");
  process.exit(1);
}

if (Number(metrics.fail || 0) > 0 || Number(metrics.cancelled || 0) > 0) {
  console.error(`Tests failed (${metrics.fail || 0} failed, ${metrics.cancelled || 0} cancelled). Refusing to update proof.`);
  process.exit(1);
}

console.log("Extracted metrics:", metrics);

let proofContent = fs.readFileSync(proofFile, "utf8");

const replacement = `# tests ${metrics.tests}
# suites ${metrics.suites}
# pass ${metrics.pass}
# fail ${metrics.fail || 0}
# cancelled ${metrics.cancelled || 0}
# skipped ${metrics.skipped || 0}
# todo ${metrics.todo || 0}`;

proofContent = proofContent.replace(/# tests \d+\r?\n# suites \d+\r?\n# pass \d+\r?\n# fail \d+\r?\n# cancelled \d+\r?\n# skipped \d+\r?\n# todo \d+/m, replacement);

fs.writeFileSync(proofFile, proofContent);
console.log("DEPENDENCY_PROOF.md updated successfully.");
