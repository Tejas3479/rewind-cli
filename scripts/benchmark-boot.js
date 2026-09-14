
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { StorageEngine } from "../src/storage/store.js";

function createDummyRecord(id) {
  return {
    id: String(id),
    schemaVersion: 1,
    fingerprint: `fp-${id}`,
    command: "test-cmd",
    fullCommand: "test-cmd --args",
    args: ["--args"],
    cwd: "/fake/dir",
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    durationMs: 10,
    exitCode: 1,
    signal: null,
    timedOut: false,
    success: false,
    stdoutRaw: "",
    stderrRaw: "error message",
    stdout: "",
    stderr: "error message",
    normalizedError: "error message",
    recoveryAttempts: [],
    status: "OBSERVED"
  };
}

async function runBenchmark(recordCount) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `rewind-bench-${recordCount}-`));
  const ledgerDir = path.join(tmpDir, ".rewind");
  const recordsDir = path.join(ledgerDir, "records");
  
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.mkdirSync(recordsDir, { recursive: true });

  console.log(`Generating ${recordCount} fake records...`);
  
  // Create checkpoint and tail event so it hits the fast-path!
  fs.writeFileSync(path.join(ledgerDir, "checkpoint.json"), JSON.stringify({
    headSequence: recordCount,
    headChainHash: "dummyhash",
    lastProcessedEventAt: new Date().toISOString()
  }));

  // Create a fake journal.jsonl
  let journal = "";
  for (let i = 1; i <= recordCount; i++) {
    const isTail = i === recordCount;
    const event = {
      sequence: i,
      timestamp: new Date().toISOString(),
      type: "failure.observed",
      incidentId: String(i),
      chainHash: isTail ? "dummyhash" : `hash-${i}`,
      prevHash: isTail ? `hash-${i-1}` : (i === 1 ? "genesis" : `hash-${i-1}`),
      payload: {}
    };
    journal += JSON.stringify(event) + "\n";
  }
  fs.writeFileSync(path.join(ledgerDir, "journal.jsonl"), journal);

  for (let i = 1; i <= recordCount; i++) {
    const record = createDummyRecord(i);
    fs.writeFileSync(path.join(recordsDir, `${i}.json`), JSON.stringify(record));
  }

  console.log(`Testing cold-boot (loadFromRecordsDir fast path)...`);
  const storage = new StorageEngine(ledgerDir);
  
  const start = performance.now();
  storage.init();
  const end = performance.now();
  
  const duration = (end - start).toFixed(2);
  console.log(`[${recordCount} records] Cold-boot took ${duration} ms\n`);
  
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function main() {
  await runBenchmark(10_000);
  await runBenchmark(50_000);
  await runBenchmark(100_000);
}

main().catch(console.error);
