# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-09-21

### Added
- **PowerShell Duration Tracking**: PowerShell prompt hook now computes command execution duration via `$lastHistory` and passes `--duration $durationMs`.
- **Projection State Machine Invariants**: Deterministic journal projection now verifies legal state transitions (`assertValidIncidentTransition` & `assertValidAttemptTransition`) in `src/storage/projection.js`.
- **CI Test & Build Verification**: Automated reproducible build verification and expanded syntax linting (`src`, `bin`, `scripts`, `test`) in GitHub Actions CI workflow.

### Fixed
- **PowerShell Argument Quoting**: Quoted `--cmd "$rawCmd"` in PowerShell hook template to prevent word splitting on commands containing spaces or quotes.
- **Kubernetes Connection Error Disambiguation**: Restriced `KUBE_CONNECTION_REFUSED_REGEX` in `src/diagnostics/parsers/kubernetes.js` to require Kubernetes context or kubectl signature prompts, avoiding false positives on generic application connection errors.
- **Proof Generator Guard**: `scripts/update-proofs.js` now exits non-zero if tests fail or are cancelled, preventing stale or invalid metrics from being committed to `DEPENDENCY_PROOF.md`.
- **Credential Scanning Safety**: Dynamically assembled dummy tokens in test fixtures and self-test diagnostics to eliminate false-positive secret scanning alerts.

## [1.0.0] - 2026-09-12

### Added

- **MCP Server** (`rewind mcp`): Zero-dependency Model Context Protocol server for AI coding agents. Exposes 5 tools (`rewind_context`, `rewind_search`, `rewind_recover`, `rewind_history`, `rewind_show`) over JSON-RPC 2.0 stdio transport. Compatible with Claude Code, Cursor, Windsurf, and any MCP-compliant client.
- **History Pagination**: `rewind history` now supports `--offset` for offset-based pagination with informative footer showing current range and next page command.
- **npm Publish Configuration**: Added `files`, `repository`, `bugs`, `homepage`, and expanded `keywords` to `package.json` for clean npm distribution.
- `.npmignore` to exclude development, and test files from npm tarball.
- `CHANGELOG.md` (this file).

### Changed

- **Package name**: Renamed from `rewind` to `rewind-cli` for npm availability.
- **Version**: Bumped from `0.1.0` to `1.0.0`.
- **Async Shell Hooks**: Bash and Zsh hooks now background the `rewind hook record` call using `( ... & )` subshell, eliminating 50-200ms prompt latency on failed commands. PowerShell was already async.
- **Single-Pass Context Engine**: `rewind context` now reads `journal.jsonl` exactly **once** per invocation (previously 3 separate reads). Integrity verification, projection, and pattern analysis all share the same pre-parsed event stream. Performance improvement scales with journal size.
- **`listRecords()` return type**: Now returns `{ records, total }` instead of a bare array, enabling pagination across all consumers.

### Fixed

- **`listRecords()` sorting**: Records are now sorted numerically by `Number.parseInt(id, 10)` instead of lexicographic comparison, fixing ordering for IDs > 9.
- **`rewind context` redundant projections**: Eliminated 3 redundant `projectEventsToRecords()` calls and 1 redundant `projectEventsToRecords()` call in the integrity return value computation.

## [0.1.0] - 2026-09-07

### Added

- Initial release for v1.0.0 Public Release.
- 18 CLI commands: `run`, `history`, `show`, `recover`, `triage`, `verify`, `search`, `patterns`, `context`, `doctor`, `verify-integrity`, `rebuild`, `hook`, `export-shared`, `import-shared`, `clear`, `help`, `version`.
- Append-only cryptographic event journal with SHA-256 chain hashing.
- Four-layer integrity verification (event hash, chain continuity, checkpoint anchor, projection consistency).
- Deterministic error fingerprinting with transient noise normalization.
- Multi-language diagnostic parsers (Node.js, Python, Go, Rust, Java, AWS, Terraform, Kubernetes).
- Trust loop state machine (OBSERVED → OPEN → RECOVERED → REGRESSED → RESOLVED).
- Negative memory for failed recovery approaches.
- Shell hooks for Bash, Zsh, and PowerShell.
- Staleness evaluation and contradiction detection.
- Agent-consumption JSON context interface.
- Reproducible deterministic build system with dual-pass SHA-256 verification.
- 393 tests across 101 suites, zero external dependencies.
