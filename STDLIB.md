# Standard Library Replacements & Package Killer Receipts (`STDLIB.md`)

> **Zero Dependency Architecture**  
> This document details every third-party package normally installed in this domain alongside the exact Node.js standard library capability Rewind implemented in its place, complete with download metrics and source code references.

---

## 💥 Package Killer Spotlight: Eliminating 800M+ Weekly Downloads

Rewind replaces an entire modern Node.js CLI toolchain with **100% standard library built-ins**. The table below highlights the top packages eliminated:

| Target Package(s) | Weekly Downloads | Rewind Standard Library Replacement | Source Location |
| :--- | :---: | :--- | :--- |
| **`chalk` / `picocolors` / `kleur`** | **150M+ / 2.6B total** | Native ANSI SGR formatting with automatic `NO_COLOR` and TTY detection | [`src/formatter.js`](./src/formatter.js) |
| **`commander` / `yargs` / `minimist`** | **160M+** | Zero-dep CLI tokenizer with subcommands, short/long flags, and trailing args | [`src/parser.js`](./src/parser.js) |
| **`strip-ansi` / `ansi-regex`** | **140M+** | Native ECMAScript regular expressions for CSI/OSC/DCS escape sequence stripping | [`src/sanitizer.js`](./src/sanitizer.js) |
| **`uuid`** | **130M+** | `node:crypto.randomUUID()` for atomic write temp files and quarantine tracking | [`src/storage/store.js`](./src/storage/store.js) |
| **`execa` / `cross-spawn`** | **120M+** | `node:child_process.spawn` with stream piping, exit code preservation & 10MB bounds | [`src/capture.js`](./src/capture.js) |
| **`diff` / `fast-diff`** | **50M+** | Pure Myers / LCS unified diff algorithm with colorized terminal hunks | [`src/diff.js`](./src/diff.js) |
| **`inquirer` / `prompts`** | **50M+** | `node:readline` with non-interactive terminal guards and pure state machine | [`src/triage/engine.js`](./src/triage/engine.js) |
| **`error-stack-parser` / `stack-trace`** | **40M+** | Conservative multi-runtime regex parsers (Node, Python, Rust, Go) | [`src/diagnostics/`](./src/diagnostics/) |
| **`sqlite3` / `better-sqlite3` / `lowdb`** | **15M+** | Append-only SHA-256 journal (`journal.jsonl`) with atomic writes & checkpointing | [`src/storage/`](./src/storage/) |
| **`simple-git` / `isomorphic-git`** | **5M+** | Pure `node:fs` reading of `.git/HEAD`, refs, and packed-refs without spawning Git | [`src/git.js`](./src/git.js) |

---

## Complete Standard Library Substitutions (16 Real Implementations)

### 1. Terminal Styling & Color Support
* **Normally:** `chalk` (250M/wk), `picocolors` (90M/wk), or `kleur` (40M/wk)
* **Rewind uses:** Native ANSI SGR escape sequences with conditional formatting driven by `process.env.NO_COLOR` and `stream.isTTY`.
* **Why:** Provides clear visual hierarchy (badges, bold, dim, cyan, green, yellow, red) with strict compliance with the [`NO_COLOR` standard](https://no-color.org) and automatic plain-text fallback in CI/piped environments.
* **Actual Code Location:** [`src/formatter.js`](./src/formatter.js)

---

### 2. CLI Argument & Flag Parsing
* **Normally:** `commander` (115M/wk), `yargs` (80M/wk), or `minimist` (50M/wk)
* **Rewind uses:** Hand-written zero-dependency tokenizer and parser using standard JavaScript array traversal.
* **Why:** Eliminates runtime CLI dependencies while supporting command routing, positional arguments, short/long flags (`-h`, `--help`, `-n`, `--limit`), `--root`, and trailing argument preservation for `rewind run <command...>`.
* **Actual Code Location:** [`src/parser.js`](./src/parser.js)

---

### 3. Myers Unified Diff Engine
* **Normally:** `diff` (50M/wk) or `fast-diff` (15M/wk)
* **Rewind uses:** Pure Myers / Longest Common Subsequence (LCS) matrix computation with backtracking, unified diff formatting (`@@ -start,len +start,len @@`), and colorized terminal output.
* **Why:** Enables structural file and code comparison for recovery fixes and non-causal diff analysis without external packages.
* **Actual Code Location:** [`src/diff.js`](./src/diff.js)

---

### 4. UUID Generation
* **Normally:** `uuid` (130M/wk)
* **Rewind uses:** `node:crypto.randomUUID()`
* **Why:** Generates cryptographically secure, collision-free UUIDs for atomic write temp files and quarantine records without external dependencies.
* **Actual Code Location:** [`src/storage/store.js`](./src/storage/store.js)

---

### 5. Deterministic SHA-256 Hashing
* **Normally:** `crypto-js`, `sha.js`, or `hasha`
* **Rewind uses:** `node:crypto.createHash('sha256')`
* **Why:** Fast, hardware-accelerated, collision-resistant calculation of reproducible 16-character hexadecimal failure fingerprints from canonical error signatures.
* **Actual Code Location:** [`src/storage/fingerprint.js`](./src/storage/fingerprint.js)

---

### 6. Child Process Execution & Live Streaming
* **Normally:** `execa` (60M/wk), `cross-spawn` (100M/wk), or `shelljs`
* **Rewind uses:** `node:child_process.spawn`
* **Why:** Provides direct process execution, real-time live output piping, high-resolution execution timing via `process.hrtime.bigint()`, accurate exit code and signal capture, and 10MB memory safety bounding.
* **Actual Code Location:** [`src/capture.js`](./src/capture.js)

---

### 7. ANSI Escape Stripping & Output Sanitization
* **Normally:** `strip-ansi` (140M/wk) or `ansi-regex` (140M/wk)
* **Rewind uses:** Standard ECMAScript RegExp patterns covering CSI, OSC, DCS, APC, PM sequences, and non-printable control characters.
* **Why:** Strips malicious terminal injection sequences, OSC hyperlinks, and cursor jumps before storing logs and displaying forensic output.
* **Actual Code Location:** [`src/sanitizer.js`](./src/sanitizer.js)

---

### 8. Git Metadata Inspection
* **Normally:** `simple-git` (5M/wk), `isomorphic-git`, or invoking the `git` binary via CLI
* **Rewind uses:** Pure `node:fs` and `node:path` filesystem reading of `.git/HEAD`, loose refs (`.git/refs/heads/*`), and `packed-refs`.
* **Why:** Eliminates external runtime binary dependencies and network calls. Rewind captures commit SHAs, active branches, and detached HEAD status directly from disk without spawning `git`.
* **Actual Code Location:** [`src/git.js`](./src/git.js)

---

### 9. Storage Engine & Database
* **Normally:** `sqlite3`, `better-sqlite3`, `level`, or `lowdb`
* **Rewind uses:** Append-only authoritative event journal (`.rewind/journal.jsonl`) with trusted cryptographic checkpointing (`.rewind/checkpoint.json`), derived in-memory indices, and disposable incident projections (`.rewind/records/<id>.json`) managed with crash-safe atomic writes (`write tmp` $\rightarrow$ `fsyncSync` $\rightarrow$ `safeAtomicRenameSync`).
* **Why:** Provides a transparent, inspectable, human-readable local ledger that requires zero C++ native addons or external database server processes. Corrupt records are isolated into `.rewind/quarantine/` with automatic startup index rebuilds.
* **Actual Code Location:** [`src/storage/store.js`](./src/storage/store.js), [`src/storage/journal.js`](./src/storage/journal.js), [`src/storage/projection.js`](./src/storage/projection.js)

---

### 10. Similarity Scoring & Near-Match Search
* **Normally:** `string-similarity`, `fuse.js`, `faiss`, or external Vector DB APIs
* **Rewind uses:** Multi-tier deterministic scoring model computing exact fingerprint lookups, token recall, and Jaccard set overlap: $\frac{|Q \cap E|}{|Q \cup E|}$.
* **Why:** Fast, fully offline, transparent, and reproducible search over historical failures without heavy embeddings, remote AI dependencies, or non-deterministic vector models.
* **Actual Code Location:** [`src/storage/search.js`](./src/storage/search.js)

---

### 11. Self-Diagnostics & System Health Audit
* **Normally:** Custom diagnostic scripts or external health-check tools (`doctor-cli`, `diagnostics`)
* **Rewind uses:** Pure Node.js 15-point diagnostic and constrained safe-repair engine verifying directory accessibility, writer locks, syntax, hash chains, projections, secret redaction, and storage size without symlink traversal.
* **Why:** Enables users and automated scripts to instantly verify ledger integrity and installation health with zero dependencies.
* **Actual Code Location:** [`src/storage/doctor.js`](./src/storage/doctor.js), [`src/commands/doctor.js`](./src/commands/doctor.js)

---

### 12. Structured Diagnostic Error Parsing
* **Normally:** `stack-trace`, `error-stack-parser`, `traceback-parser`, or language-specific AST parsers
* **Rewind uses:** Native ECMAScript regular expressions and string tokenization across Node.js/V8, Python, Rust, and Go runtimes with strict confidence classification (`EXACTLY_PARSED`, `INFERRED`, `UNKNOWN`).
* **Why:** Extracts structured runtime diagnostic metadata (error codes, exception types, source files, line/column numbers, stack frames) conservatively while preserving raw forensic evidence intact without heavy external parser libraries.
* **Actual Code Location:** [`src/diagnostics/`](./src/diagnostics/)

---

### 13. Automated Testing Framework
* **Normally:** `jest`, `mocha`, `vitest`, or `chai`
* **Rewind uses:** Native Node.js test runner (`node:test`) and assertion module (`node:assert/strict`).
* **Why:** Comprehensive unit, integration, security, and cross-platform testing (313 test cases across 90 test suites) executed directly with `node --test` without installing any test framework dependencies.
* **Actual Code Location:** [`test/*.test.js`](./test/)

---

### 14. Interactive Recovery Triage Wizard
* **Normally:** `inquirer` (50M/wk), `enquirer`, or `prompts`
* **Rewind uses:** `node:readline` and pure functional state machine (`src/triage/engine.js`).
* **Why:** Guided 7-step interactive wizard prompting for suspected cause, remediation fix, and verification command, with non-interactive terminal guards (`!isTTY`) and headless testability.
* **Actual Code Location:** [`src/triage/engine.js`](./src/triage/engine.js), [`src/commands/triage.js`](./src/commands/triage.js)

---

### 15. Shell Integrations & Passive Hook Capture
* **Normally:** Binary wrappers, shell proxies, or background daemons
* **Rewind uses:** Lightweight pure shell script templates for Bash (`trap DEBUG` + `PROMPT_COMMAND`), Zsh (`add-zsh-hook`), and PowerShell (`global:prompt`).
* **Why:** 100% optional, non-intrusive terminal failure observation that preserves the command's original exit status (`$?` / `$LASTEXITCODE`) and redacts secrets with zero shell replacement.
* **Actual Code Location:** [`src/hooks/templates.js`](./src/hooks/templates.js), [`src/commands/hook.js`](./src/commands/hook.js)

---

### 16. Project-Level Shared Recovery Bundles
* **Normally:** Remote database sync, cloud APIs, or invoking `git` CLI subprocesses
* **Rewind uses:** Pure `node:fs` and `node:crypto` JSON bundle export/import with machine path stripping (`stripMachinePaths`), secret redaction, and external evidence provenance tagging (`VERIFIED — EXTERNAL EVIDENCE`).
* **Why:** Allows developers to safely export, commit, pull, and share verified remediation knowledge without touching Git, running daemons, or compromising local verification trust.
* **Actual Code Location:** [`src/sharing/bundle.js`](./src/sharing/bundle.js), [`src/commands/export_shared.js`](./src/commands/export_shared.js), [`src/commands/import_shared.js`](./src/commands/import_shared.js)
