<div align="center">
  <img src="https://github.com/user-attachments/assets/placeholder-logo" width="120" alt="Rewind Logo" />
  <h1>Rewind CLI</h1>
  <p><strong>Remember what fixed it. A verified-recovery ledger for the terminal.</strong></p>

  [![npm version](https://img.shields.io/npm/v/rewind-cli.svg?color=blue&style=flat-square)](https://www.npmjs.com/package/rewind-cli)
  [![CI Build](https://img.shields.io/github/actions/workflow/status/Tejas3479/rewind/ci.yml?branch=main&style=flat-square)](https://github.com/Tejas3479/rewind/actions)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
  [![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-green.svg?style=flat-square)](https://nodejs.org)
  [![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg?style=flat-square)](https://www.npmjs.com/package/rewind-cli)

  <br />
  <em>Stop googling the same terminal errors. Capture failures, verify fixes, and build a permanent local memory of how your project works.</em>
</div>

---

## ⚡ Why Rewind?

We've all been there: a script fails, you spend 20 minutes debugging, you find the fix, and you move on. A month later, it fails again—and you've completely forgotten the solution.

**Rewind** is a zero-dependency CLI tool that lives in your project. It captures command failures, preserves forensic evidence (logs, git state, environment), and lets you record and *cryptographically verify* the fix. When that identical failure happens again, Rewind instantly surfaces the verified remedy.

### ✨ Features
* **Zero Dependencies:** Written purely in Node.js built-ins. Lightning fast, zero bloat, incredibly secure.
* **100% Local & Privacy-First:** Everything stays in your `.rewind` folder. No telemetry, no cloud syncing, no network requests.
* **Cryptographic Ledger:** Fixes are recorded in an append-only JSONL journal, sealed with SHA-256 hashes to guarantee integrity.
* **AI-Ready (MCP):** Exposes a Model Context Protocol server. Give your AI coding agents (Claude, Cursor) instant access to your project's historical failure memory.
* **Zero Auto-Execution:** Strict safety invariants. Rewind will *never* run historical fixes automatically.

---

## 🚀 Installation

Install globally via npm:

```bash
npm install -g rewind-cli
```

Initialize a ledger in your current project:
```bash
cd my-project
rewind init
```

---

## 📖 Quick Start: The Trust Loop

Rewind follows a strict state machine to ensure fixes are actually valid.

### 1. Observe a Failure
Run your commands through Rewind. If it exits with a non-zero code, it's recorded.
```bash
rewind run npm run build
```
*(Tip: Install our [shell hooks](#-shell-integration) to skip typing `rewind run`!)*

### 2. Triage & Recover
Launch the interactive triage wizard to document what went wrong and how to fix it:
```bash
rewind triage
```
*(Or do it manually: `rewind recover <id> --cause "..." --change "..." --verify-cmd "..."`)*

### 3. Verify & Seal
Rewind requires you to prove the fix works by running an explicit verification command.
```bash
rewind verify <id>
```
If the verification passes, the fix is sealed as **VERIFIED**. The next time that specific error signature occurs, Rewind will immediately flag it as a known regression and show you the exact fix.

---

## 🛠️ Configuration

Rewind supports zero-config out of the box, but can be customized via a `.rewindrc` or `rewind.config.json` file in your project root or home directory.

```json
{
  "defaultLimit": 20,
  "colorOutput": true,
  "redactPatterns": ["API_KEY_.*", "SECRET_.*"]
}
```

---

## 💻 Commands Reference

| Command | Description |
| :--- | :--- |
| **Core** | |
| `rewind run <cmd...>` | Execute a command and capture failure evidence on non-zero exit |
| `rewind history` | View failure records and recovery ledger timeline |
| `rewind show <id>`| Inspect forensic failure snapshot, logs, environment, and diffs |
| `rewind search <query>`| Search historical failures by keyword, error text, or fingerprint |
| **Recovery** | |
| `rewind triage [id]` | Interactive 7-step guided recovery triage and verification wizard |
| `rewind recover <id>` | Record suspected cause, remediation change, and verify command |
| `rewind verify <id>` | Execute the approved verification command to validate the fix |
| `rewind patterns` | Analyze historical failures for flakiness and deterministic patterns |
| **Advanced** | |
| `rewind context` | Query structured forensic diagnostic context for coding agents |
| `rewind export-shared` | Export portable, sanitized recovery bundle for team sharing |
| `rewind import-shared` | Import verified knowledge from a shared recovery bundle |
| `rewind hook <shell>` | Generate passive failure-observation hooks (`bash`, `zsh`, `powershell`) |
| `rewind mcp` | Start Model Context Protocol (MCP) server |
| **Maintenance** | |
| `rewind doctor` | Run installation & ledger health audit with safe repair capability |
| `rewind verify-integrity` | Perform read-only cryptographic audit across hash chain |
| `rewind clear` | Safely wipe the local ledger |

---

## 🔌 Shell Integration

Rewind includes optional shell hooks. These allow normal commands to execute naturally without the `rewind run` prefix, while automatically capturing failures in the background.

**Bash:** `eval "$(rewind completions bash)"` (Add to `~/.bashrc`)
**Zsh:** `eval "$(rewind completions zsh)"` (Add to `~/.zshrc`)
**PowerShell:** `Invoke-Expression (& rewind completions powershell | Out-String)` (Add to `$PROFILE`)

---

## 🤖 AI Agent Integration (MCP)

Rewind acts as long-term negative memory for AI coding agents. By starting the built-in MCP server, tools like Claude Desktop or Cursor can search your project's historical failures to avoid repeating past mistakes.

Add this to your MCP client config (e.g. `claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "rewind": {
      "command": "rewind",
      "args": ["mcp"],
      "env": {
        "REWIND_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

---

## 🛡️ Security & Privacy

Rewind is designed with strict security invariants:
1. **Redaction Engine:** Automatically strips secrets (AWS keys, GitHub tokens, passwords) from captured stdout/stderr and environment variables.
2. **Buffer Limits:** Strictly caps stream memory allocation to prevent resource exhaustion attacks.
3. **No Execution Without Consent:** Rewind never automatically applies historical fixes.

## 📄 License
MIT © Tejas
