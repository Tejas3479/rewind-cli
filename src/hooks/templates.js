/**
 * Shell hook template generators for REWIND.
 * Provides zero-dependency, non-intrusive integration scripts for bash, zsh, and PowerShell.
 */

export const SUPPORTED_SHELLS = Object.freeze(['bash', 'zsh', 'fish', 'powershell', 'pwsh']);

/**
 * Normalizes shell name.
 *
 * @param {string} shell
 * @returns {'bash'|'zsh'|'fish'|'powershell'|null}
 */
export function normalizeShellName(shell) {
  if (!shell || typeof shell !== 'string') return null;
  const s = shell.trim().toLowerCase();
  if (s === 'bash') return 'bash';
  if (s === 'zsh') return 'zsh';
  if (s === 'fish') return 'fish';
  if (s === 'powershell' || s === 'pwsh' || s === 'ps' || s === 'ps1') return 'powershell';
  return null;
}

/**
 * Generates bash shell integration hook script.
 *
 * @param {object} [options]
 * @returns {string}
 */
export function getBashHook(options = {}) {
  return `# REWIND Shell Integration for Bash
# ------------------------------------------------------------------------------
# To install in your current shell:
#   eval "$(rewind hook bash)"
#
# To install permanently, add this line to your ~/.bashrc:
#   eval "$(rewind hook bash)"
# ------------------------------------------------------------------------------

if [[ $- == *i* ]]; then
  _rewind_preexec() {
    # Skip if command was triggered inside prompt command or internal eval
    if [[ "$BASH_COMMAND" == "_rewind_prompt"* || "$BASH_COMMAND" == "eval "* || "$BASH_COMMAND" == *"PROMPT_COMMAND"* ]]; then
      return
    fi
    _REWIND_LAST_CMD="$BASH_COMMAND"
    _REWIND_CMD_START=$(date +%s%3N 2>/dev/null || date +%s 2>/dev/null || echo 0)
  }

  _rewind_prompt() {
    local _rewind_exit=$?
    if [[ -n "$_REWIND_LAST_CMD" && $_rewind_exit -ne 0 ]]; then
      # Avoid recording rewind itself or internal helpers
      if [[ "$_REWIND_LAST_CMD" != rewind* && "$_REWIND_LAST_CMD" != *bin/rewind* && "$_REWIND_LAST_CMD" != "_rewind_"* ]]; then
        local _rewind_duration=0
        if [[ -n "$_REWIND_CMD_START" && "$_REWIND_CMD_START" -ne 0 ]]; then
          local _rewind_now=$(date +%s%3N 2>/dev/null || date +%s 2>/dev/null || echo 0)
          if [[ $_rewind_now -ge $_REWIND_CMD_START ]]; then
            _rewind_duration=$((_rewind_now - _REWIND_CMD_START))
          fi
        fi
        ( rewind hook record --exit "$_rewind_exit" --cmd "$_REWIND_LAST_CMD" --duration "$_rewind_duration" & ) 2>/dev/null
      fi
    fi
    _REWIND_LAST_CMD=""
    _REWIND_CMD_START=0
    return $_rewind_exit
  }

  trap '_rewind_preexec' DEBUG
  if [[ -z "$PROMPT_COMMAND" ]]; then
    PROMPT_COMMAND="_rewind_prompt"
  elif [[ "$PROMPT_COMMAND" != *"_rewind_prompt"* ]]; then
    PROMPT_COMMAND="_rewind_prompt; $PROMPT_COMMAND"
  fi
fi
`;
}

/**
 * Generates zsh shell integration hook script.
 *
 * @param {object} [options]
 * @returns {string}
 */
export function getZshHook(options = {}) {
  return `# REWIND Shell Integration for Zsh
# ------------------------------------------------------------------------------
# To install in your current shell:
#   eval "$(rewind hook zsh)"
#
# To install permanently, add this line to your ~/.zshrc:
#   eval "$(rewind hook zsh)"
# ------------------------------------------------------------------------------

if [[ -o interactive ]]; then
  autoload -Uz add-zsh-hook 2>/dev/null

  _rewind_preexec() {
    _REWIND_LAST_CMD="$1"
    _REWIND_CMD_START=$(date +%s%3N 2>/dev/null || date +%s 2>/dev/null || echo 0)
  }

  _rewind_precmd() {
    local _rewind_exit=$?
    if [[ -n "$_REWIND_LAST_CMD" && $_rewind_exit -ne 0 ]]; then
      if [[ "$_REWIND_LAST_CMD" != rewind* && "$_REWIND_LAST_CMD" != *bin/rewind* && "$_REWIND_LAST_CMD" != "_rewind_"* ]]; then
        local _rewind_duration=0
        if [[ -n "$_REWIND_CMD_START" && "$_REWIND_CMD_START" -ne 0 ]]; then
          local _rewind_now=$(date +%s%3N 2>/dev/null || date +%s 2>/dev/null || echo 0)
          if [[ $_rewind_now -ge $_REWIND_CMD_START ]]; then
            _rewind_duration=$((_rewind_now - _REWIND_CMD_START))
          fi
        fi
        ( rewind hook record --exit "$_rewind_exit" --cmd "$_REWIND_LAST_CMD" --duration "$_rewind_duration" & ) 2>/dev/null
      fi
    fi
    _REWIND_LAST_CMD=""
    _REWIND_CMD_START=0
    return $_rewind_exit
  }

  if typeset -f add-zsh-hook >/dev/null 2>&1; then
    add-zsh-hook preexec _rewind_preexec
    add-zsh-hook precmd _rewind_precmd
  else
    preexec_functions+=(_rewind_preexec)
    precmd_functions+=(_rewind_precmd)
  fi
fi
`;
}

/**
 * Generates PowerShell integration hook script.
 *
 * @param {object} [options]
 * @returns {string}
 */
export function getPowerShellHook(options = {}) {
  return `# REWIND Shell Integration for PowerShell
# ------------------------------------------------------------------------------
# To install in your current PowerShell session:
#   Invoke-Expression (& rewind hook powershell | Out-String)
#
# To install permanently, add this line to your PowerShell $PROFILE:
#   Invoke-Expression (& rewind hook powershell | Out-String)
# ------------------------------------------------------------------------------

if ($Host.UI.RawUI -and [Environment]::UserInteractive) {
    if (-not (Test-Path Function:\\_rewind_original_prompt)) {
        if (Test-Path Function:\\prompt) {
            Copy-Item Function:\\prompt Function:\\_rewind_original_prompt
        } else {
            function global:_rewind_original_prompt { "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) " }
        }
    }

    function global:prompt {
        $origLastExit = $global:LASTEXITCODE

        try {
            if ($origLastExit -and $origLastExit -ne 0) {
                $lastHistory = Get-History -Count 1 -ErrorAction SilentlyContinue
                if ($lastHistory -and $lastHistory.CommandLine) {
                    $rawCmd = $lastHistory.CommandLine.Trim()
                    if ($rawCmd -and -not ($rawCmd.StartsWith("rewind") -or $rawCmd.Contains("bin/rewind") -or $rawCmd.Contains("bin\\rewind"))) {
                        & rewind hook record --exit $origLastExit --cmd $rawCmd 2>$null
                    }
                }
            }
        } catch {
            # Never fail or disrupt prompt execution
        } finally {
            # Invariant: Strictly restore authorative exit code
            $global:LASTEXITCODE = $origLastExit
        }

        _rewind_original_prompt
    }
}
`;
}

/**
 * Generates fish shell integration hook script.
 *
 * @param {object} [options]
 * @returns {string}
 */
export function getFishHook(options = {}) {
  return `# REWIND Shell Integration for Fish
# ------------------------------------------------------------------------------
# To install in your current shell:
#   rewind hook fish | source
#
# To install permanently, add this line to your ~/.config/fish/config.fish:
#   rewind hook fish | source
# ------------------------------------------------------------------------------

status is-interactive; or exit

function _rewind_postexec --on-event fish_postexec
    set -l last_status $status
    set -l cmd $argv[1]
    
    if test $last_status -ne 0
        if not string match -q 'rewind*' "$cmd"; and not string match -q '*bin/rewind*' "$cmd"
            set -l duration_ms 0
            if test -n "$CMD_DURATION"
                set duration_ms $CMD_DURATION
            end
            command rewind hook record --exit "$last_status" --cmd "$cmd" --duration "$duration_ms" >/dev/null 2>&1 &
            disown $last_pid 2>/dev/null
        end
    end
end
`;
}

/**
 * Renders the terminal interactive overview for supported hooks.
 *
 * @param {import('../formatter.js').createStyler} styler
 * @returns {string}
 */
export function getInstallationOverview(styler) {
  const s = styler;
  const lines = [
    `${s.bold('REWIND SHELL HOOKS')} — Automatic Non-Intrusive Failure Observation`,
    `${s.dim('Allow normal commands (npm test, python app.py, cargo test) to execute naturally while passively recording failures.')}`,
    '',
    `${s.bold('SUPPORTED SHELLS:')}`,
    `  • ${s.cyan('bash')}        Bourne Again Shell (macOS / Linux / WSL / Git Bash)`,
    `  • ${s.cyan('zsh')}         Z Shell (macOS default / Linux)`,
    `  • ${s.cyan('fish')}        Friendly Interactive Shell (macOS / Linux)`,
    `  • ${s.cyan('powershell')}  PowerShell 5.1 & PowerShell Core 7+ (Windows / macOS / Linux)`,
    '',
    `${s.bold('USAGE:')}`,
    `  ${s.cyan('rewind hook <shell>')}    Print the shell integration script to stdout`,
    '',
    `${s.bold('INSTALLATION:')}`,
    `  ${s.bold('Bash')} (~/.bashrc):`,
    `    ${s.yellow('eval "$(rewind hook bash)"')}`,
    '',
    `  ${s.bold('Zsh')} (~/.zshrc):`,
    `    ${s.yellow('eval "$(rewind hook zsh)"')}`,
    '',
    `  ${s.bold('Fish')} (~/.config/fish/config.fish):`,
    `    ${s.yellow('rewind hook fish | source')}`,
    '',
    `  ${s.bold('PowerShell')} ($PROFILE):`,
    `    ${s.yellow('Invoke-Expression (& rewind hook powershell | Out-String)')}`,
    '',
    `${s.bold('SAFETY & TRUST GUARANTEES:')}`,
    `  • ${s.dim('Zero Modification:')} Rewind never automatically edits your shell profile or rc files.`,
    `  • ${s.dim('Exit Status Preservation:')} Commands retain their exact exit status ($? / $LASTEXITCODE).`,
    `  • ${s.dim('Fault Tolerant:')} If Rewind encounters any error while recording, original behavior is preserved.`,
    `  • ${s.dim('Privacy Compliant:')} Redacts credentials and non-allowlisted environment keys identical to "rewind run".`
  ];

  return lines.join('\n');
}
