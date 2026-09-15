
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";

async function runBenchmark(count) {
  const file = path.join(os.tmpdir(), `journal-${count}.jsonl`);
  let data = "";
  for(let i=0; i<count; i++) {
    data += JSON.stringify({ sequence: i, type: "failure.observed", incidentId: "xyz", payload: { command: "test", exitCode: 1 } }) + "\n";
  }
  fs.writeFileSync(file, data);

  const start = performance.now();
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n");
  const events = [];
  for(const line of lines) {
    if(line) events.push(JSON.parse(line));
  }
  const end = performance.now();
  console.log(`[${count} events] Read and parse took ${(end-start).toFixed(2)} ms`);
  fs.rmSync(file);
}

runBenchmark(100_000);
runBenchmark(500_000);
