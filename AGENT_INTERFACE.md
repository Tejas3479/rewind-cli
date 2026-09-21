# REWIND Agent-Consumption Interface Specification

> **Version:** `1.0.0`  
> **Status:** Standard Machine Interface  
> **Runtime Dependencies:** `0` (Zero external packages, zero AI APIs, zero remote services)

---

## 1. Overview & Core Purpose

REWIND is an offline, zero-dependency command intelligence tool that records execution failures, forensic evidence, multi-attempt remediation hypotheses, and user-approved verification runs.

The **Agent-Consumption Interface** allows autonomous and interactive coding agents (e.g. Claude Code, Gemini CLI, Cursor, Codex, and custom terminal automation agents) to query historical failure context **without turning Rewind into an AI product** and **without treating historical remedies as executable authority**.

### Core Guarantees for Consuming Agents:
1. **Deterministic JSON Contract**: Stable field names, predictable array structures, and typed schemas.
2. **Pure Output Hygiene**: When invoked with `--json`, Rewind writes **100% parseable JSON** to `stdout` with zero banner text, zero interactive prompts, and zero ANSI escape sequences.
3. **Strict Non-Auto-Execution Policy**: Historical verification commands and past fixes are explicitly labeled as **`HISTORICAL_RECOVERY`** with `action: "REVIEW"` and `mayAutoExecute: false`. Consuming agents are forbidden from automatically replaying historical commands.
4. **Authoritative Ledger Trust Verification**: Context includes a cryptographic audit report of the local event journal (`.rewind/journal.jsonl`). If tampering or corruption is detected, historical claims are downgraded to `UNTRUSTED_EVIDENCE`.
5. **Secret Redaction**: API keys (OpenAI, AWS, GitHub PATs, Slack, private keys, bearer tokens) are scrubbed before payload assembly.

---

## 2. Command Reference

| Command | Output Target | Purpose |
| :--- | :--- | :--- |
| `rewind context latest --json` | `stdout` | Resolve the most recent failure incident and return complete forensic evidence and remedies |
| `rewind context <id> --json` | `stdout` | Resolve a specific historical incident (e.g. `rewind context 4 --json`) |
| `rewind history --json` | `stdout` | Full timeline of recorded incidents and their current verification states |
| `rewind show <id> --json` | `stdout` | Complete uncurated forensic snapshot of a single incident |
| `rewind search <query> --json` | `stdout` | Deterministic keyword and near-match similarity search across historical incidents |
| `rewind doctor --json` | `stdout` | Complete 15-check ledger health, storage consistency, and diagnostics report |
| `rewind patterns --json` | `stdout` | Empirical failure family patterns (flakiness, regressions, environment skews) |
| `rewind verify-integrity --json` | `stdout` | Read-only 4-layer cryptographic ledger integrity audit |
| `rewind export-shared --json` | `stdout` | Export sanitized verified recovery knowledge bundle for sharing |
| `rewind import-shared <file> --json` | `stdout` | Import shared recovery bundle as external evidence |

---

## 3. Agent Context Schema (`rewind context latest --json`)

### Complete JSON Structure Example

```json
{
  "status": "success",
  "contextSchemaVersion": "1.1.0",
  "sourceJournalFormat": 1,
  "query": {
    "target": "latest",
    "resolvedIncidentId": "14"
  },
  "ledgerTrust": {
    "status": "TRUSTED",
    "isTrusted": true,
    "violationsCount": 0,
    "violations": []
  },
  "observedEvidence": {
    "failure": {
      "id": "14",
      "status": "OPEN",
      "command": "npm",
      "args": ["test"],
      "fullCommand": "npm test",
      "cwd": "/workspace/project",
      "exitCode": 1,
      "signal": null,
      "durationMs": 45,
      "createdAt": "2026-08-29T15:30:00.000Z",
      "fingerprint": "a1b2c3d4e5f6",
      "normalizedError": "ECONNREFUSED 127.0.0.1:5432",
      "storedEvidenceHash": "7f8a9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a",
      "stderrSnippet": "Error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect",
      "stdoutSnippet": "",
      "isTruncated": false,
      "git": {
        "isGit": true,
        "headCommit": "4a8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
        "branch": "main"
      },
      "environment": {
        "platform": "linux",
        "nodeMajor": 22
      },
      "regressionOf": null
    },
    "historicalMatches": {
      "exactCount": 1,
      "exact": [
        {
          "incidentId": "1",
          "fingerprint": "a1b2c3d4e5f6",
          "status": "RECOVERED",
          "matchType": "EXACT",
          "similarity": null,
          "evidenceStrength": "STRONG",
          "verificationState": "VERIFIED",
          "firstSeen": "2026-08-28T10:00:00.000Z",
          "command": "npm",
          "fullCommand": "npm test"
        }
      ],
      "similarCount": 1,
      "similar": [
        {
          "incidentId": "5",
          "fingerprint": "b2c3d4e5f6a1",
          "status": "OPEN",
          "matchType": "SIMILAR",
          "similarity": 0.82,
          "evidenceStrength": "SUPPORTED",
          "verificationState": "UNVERIFIED",
          "matchedTerms": ["econnrefused", "5432"],
          "command": "npm",
          "fullCommand": "npm run test:e2e"
        }
      ]
    },
    "remedies": {
      "hasVerifiedRemedy": true,
      "verifiedCount": 1,
      "verified": [
        {
          "type": "HISTORICAL_RECOVERY",
          "status": "VERIFIED",
          "trustLevel": "VERIFIED_IN_LEDGER",
          "cause": "PostgreSQL container was not running",
          "change": "Started local container via docker compose up -d postgres",
          "verificationCommand": {
            "command": "npm test",
            "role": "VERIFICATION_ONLY",
            "mayAutoExecute": false
          },
          "provenance": {
            "sourceIncidentId": "1",
            "sourceRecoveryAttemptId": 2,
            "evidenceRef": "evidence/7f8a9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a.log"
          },
          "historicalVerification": {
            "status": "VERIFIED",
            "verifiedAt": "2026-08-28T10:05:00.000Z",
            "runsCount": 1,
            "lastRunResult": {
              "exitCode": 0,
              "durationMs": 120,
              "outputSnippet": "PASS: 12 test suites passed",
              "storedOutputHash": "3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f"
            }
          },
          "currentApplicability": {
            "status": "APPLICABLE",
            "isStale": false,
            "reasons": []
          },
          "action": "REVIEW",
          "safetyNotice": "Historical recovery is empirical evidence. Review code context and tests before applying remediation."
        }
      ],
      "failedCount": 1,
      "failedApproaches": [
        {
          "type": "FAILED_APPROACH",
          "status": "FAILED",
          "cause": "Assumed wrong port configuration",
          "change": "Modified DB_PORT to 5433",
          "verifyCmd": "npm test",
          "provenance": {
            "sourceIncidentId": "1",
            "sourceRecoveryAttemptId": 1,
            "evidenceRef": "evidence/7f8a9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a.log"
          },
          "warning": "This remediation hypothesis failed verification under recorded conditions."
        }
      ]
    }
  },
  "derivedAnalysis": {
    "patterns": [
      "RECURRING_FAILURE",
      "FREQUENTLY_VERIFIED_RECOVERY"
    ],
    "applicability": {
      "staleness": {
        "isStale": false,
        "reasons": []
      },
      "conflicts": {
        "hasConflict": false,
        "status": "NONE",
        "details": []
      }
    },
    "unprovenAssumptions": [
      "No environment delta detected between recorded verification and current runtime."
    ]
  },
  "warnings": [],
  "recommendedAction": "REVIEW_HISTORICAL_EVIDENCE",
  "suggestedActions": [
    "REVIEW_HISTORICAL_EVIDENCE",
    "FORMULATE_NEW_HYPOTHESIS",
    "PROPOSE_RECOVERY",
    "REQUEST_VERIFICATION"
  ],
  "allowedNextActions": [
    "REVIEW_HISTORICAL_EVIDENCE",
    "FORMULATE_NEW_HYPOTHESIS",
    "PROPOSE_RECOVERY",
    "REQUEST_VERIFICATION"
  ],
  "safety": {
    "readOnly": true,
    "mayAutoExecuteCommands": false,
    "historicalRecoveryAutoExecution": false,
    "verificationRequiresExplicitUserFlow": true,
    "notice": "Historical recovery is empirical evidence, not executable authority. Never automatically replay commands without human or policy review."
  }
}
```

---

## 4. Key Agent Consumption Rules

### Rule 1: Always Check `ledgerTrust`
Before relying on historical claims:
- If `ledgerTrust.isTrusted === true`: The cryptographic SHA-256 hash chain matches the immutable journal. Verified recoveries reflect authentic prior executions.
- If `ledgerTrust.isTrusted === false`: The ledger has been tampered with or corrupted. All remedies are downgraded to `UNTRUSTED_EVIDENCE`.

### Rule 2: Distinguish Exact vs. Similar Matches
- `historicalMatches.exact`: Incidents sharing the exact same conservative SHA-256 error fingerprint.
- `historicalMatches.similar`: Incidents retrieved by TF-IDF / keyword similarity. **Similarity does not equal causality or verified identity.**

### Rule 3: Inspect `failedApproaches` (Negative Memory)
Before proposing a fix, inspect `observedEvidence.remedies.failedApproaches`. If an approach failed in the past, avoid proposing the exact same flawed change.

### Rule 4: Check `currentApplicability`
If `currentApplicability.isStale === true`, the current environment differs from the recorded verification run (e.g. different major Node.js runtime or different OS).

---

## 5. Agent Integration Recipes

### A. Claude Code Configuration (`CLAUDE.md`)

Add the following instructions to your project's `CLAUDE.md`:

```markdown
# Rewind Integration Instructions for Claude Code

When running builds or test suites:
1. Always execute commands wrapped with Rewind:
   `rewind run <command...>`
2. If the command fails, query historical context:
   `rewind context latest --json`
3. Inspect `observedEvidence.remedies.verified` for prior proven fixes.
4. Avoid any approach listed in `observedEvidence.remedies.failedApproaches`.
5. When proposing code edits, record your recovery hypothesis:
   `rewind recover <id> --cause "<cause>" --change "<change>" --verify-cmd "<test cmd>"`
6. Ask the human user to verify the fix:
   `rewind verify <id>`
```

---

### B. Cursor Rules (`.cursorrules`)

Add the following rule to your repository root:

```markdown
# Rewind Terminal Verification Rules
- When a terminal command fails, execute `rewind context latest --json` to inspect historical failure evidence.
- NEVER automatically replay historical recovery commands as executable scripts.
- Check negative memory in `observedEvidence.remedies.failedApproaches` before formulating new fixes.
- Once a fix is applied, guide the user to run `rewind verify <id>`.
```

---

### C. Gemini CLI & Terminal Agent Loop

```bash
# 1. Execute wrapped process
rewind run npm test

# 2. If non-zero exit, fetch agent context
rewind context latest --json

# 3. Formulate fix and record hypothesis
rewind recover 14 --cause "Postgres port mismatch" --change "Updated port in .env" --verify-cmd "npm test"

# 4. Seal verification
rewind verify 14
```

---

## 6. MCP Server Integration (Model Context Protocol)

Rewind includes an enterprise-grade, zero-dependency Model Context Protocol (MCP) server that exposes verified recovery knowledge, automated verification loops, ledger integrity audits, and failure pattern intelligence to AI coding agents via JSON-RPC 2.0 over `stdio`.

### Protocol Conformance & Capabilities

- **Transport**: Standard I/O (`stdio`) using line-delimited JSON-RPC 2.0.
- **Protocol Versions**: Dynamically negotiates `2024-11-05`, `2025-03-26`, `2025-11-25`, or `2026-07-28`.
- **JSON-RPC 2.0 Conformance**: Strict notification handling (messages without an `id` receive no response or error output, preserving stdio stream integrity).
- **Tool Safety Annotations**: Emits 2026 standard execution hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) for transparent client-side auto-approvals.
- **Resources**: Direct URIs and RFC 6570 URI Templates for on-demand failure dumps and live health telemetry.
- **Prompts**: Built-in interactive guidance with Negative Memory safeguards to prevent AI fix loops.

### Starting the MCP Server

```bash
rewind mcp
```

Or via direct stdio pipe from any compliant host.

---

### Available Tools (8 Tools)

| Tool | Safety Annotations | Description | Required Parameters | Optional Parameters |
|:---|:---|:---|:---|:---|
| `rewind_context` | `readOnlyHint: true`, `idempotentHint: true` | Retrieves structured forensic context for an incident including git diffs, negative memory warnings, and active contradictions. | — | `incidentId` (default: `"latest"`) |
| `rewind_search` | `readOnlyHint: true`, `idempotentHint: true` | Semantically searches past failures, verified fixes, and command histories with deduplicated ranking. | `query` (string) | `limit` (number, default: `5`) |
| `rewind_history` | `readOnlyHint: true`, `idempotentHint: true` | Lists recent terminal failures and incident timelines. | — | `limit` (number, default: `10`) |
| `rewind_show` | `readOnlyHint: true`, `idempotentHint: true` | Inspects full details of an incident (captured stdout/stderr, environment fingerprints, diagnostics). | `incidentId` (string) | — |
| `rewind_doctor` | `readOnlyHint: true`, `idempotentHint: true` | Runs a 15-check cryptographic and operational audit of the Rewind ledger, projections, and journal health. | — | — |
| `rewind_patterns` | `readOnlyHint: true`, `idempotentHint: true` | Returns empirical failure clusters, flakiness diagnostics, and recurring regression trends. | — | — |
| `rewind_recover` | `readOnlyHint: false`, `destructiveHint: false` | Records an agent's root-cause hypothesis and proposed change into the append-only ledger (`SUSPECTED`). | `incidentId` (string), `cause` (string), `change` (string) | `verifyCmd` (string) |
| `rewind_verify` | `readOnlyHint: false`, `destructiveHint: false` | Executes the stored verification command, captures output, and autonomously seals the incident state to `FIXED`/`VERIFIED` or `FAILED`. | `incidentId` (string) | — |

---

### MCP Resources

Rewind exposes read-only resource URIs allowing agents to inspect ledger states and incident logs without executing tool queries:

#### Static Resources (`resources/list`)

- `rewind://incidents/latest`: Snapshot of the most recent failure in the active workspace (`application/json`).
- `rewind://doctor/health`: Cryptographic integrity report and ledger operational health (`application/json`).
- `rewind://patterns`: Recurrent failure patterns and test flakiness analysis (`application/json`).
- Dynamic recent incidents: Direct endpoints for recent failures (e.g. `rewind://incidents/inc_abc123`).

#### Resource Templates (`resources/templates/list`)

- `rewind://incidents/{id}`: RFC 6570 template for detailed incident metadata and diagnostic stack traces (`application/json`).
- `rewind://incidents/{id}/evidence`: RFC 6570 template for raw captured terminal output and stderr text (`text/plain`).

---

### MCP Prompts (`prompts/list` & `prompts/get`)

Rewind ships with production prompt templates that guide LLM agents through structured troubleshooting and prevent repeated mistakes:

1. **`triage-latest`**:
   - Injects the latest terminal failure, parsed stack traces, and **Negative Memory alerts** (disproved causes from prior failed remediation attempts).
   - Instructs the agent to formulate a new, non-repeating hypothesis.
2. **`verify-fix`**:
   - Guides the agent through validating code modifications using the stored verification command (`rewind_verify`), completing the Trust Loop.
3. **`explain-incident`**:
   - Takes `incidentId` and asks the model to produce a root-cause explanation suitable for human teammates or pull request summaries.

---

### Client Configurations

#### Claude Desktop & Claude Code
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "rewind": {
      "command": "rewind",
      "args": ["mcp"]
    }
  }
}
```

#### Cursor MCP Settings
Add to Cursor Settings > Features > MCP:
```json
{
  "mcpServers": {
    "rewind": {
      "command": "rewind",
      "args": ["mcp"],
      "type": "stdio"
    }
  }
}
```

#### VS Code + Continue
Add to `.continue/config.json`:
```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "rewind",
          "args": ["mcp"]
        }
      }
    ]
  }
}
```

#### Windsurf / Cascade
Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "rewind": {
      "command": "rewind",
      "args": ["mcp"]
    }
  }
}
```

#### Generic MCP Client
```bash
# Handshake with stdio line-delimited JSON-RPC 2.0:
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"custom-agent"}}}' | rewind mcp
```
