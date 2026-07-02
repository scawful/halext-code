/**
 * Pure detection/extraction logic for the comms guardrail.
 *
 * Kept in a nested directory (not `plugins/*.ts`) on purpose: the opencode plugin
 * loader treats every `.opencode/plugins/*.{ts,js}` module as a plugin and invokes
 * ALL of its exports as plugin factories. A module that exports helpers/constants
 * would crash the loader, so only the export-pure `../comms-guardrail.ts` lives at
 * the top level; everything testable lives here.
 */

// Binaries whose sole purpose is to send outward comms → always confirm.
export const COMMS_BINARIES: Record<string, string> = {
  gchat: "Google Chat",
  sendmail: "Email",
  mailx: "Email",
  msmtp: "Email",
  mutt: "Email",
}

const WEBHOOK_URL = /(hooks\.slack\.com|chat\.googleapis\.com|discord(app)?\.com\/api\/webhooks|\/webhooks?\b)/i
const LEADING_WRAPPERS = new Set(["sudo", "env", "command", "nohup", "time", "xargs"])

// Interpreters that run an inline script from a `-c`-style flag. A comms command
// hidden inside one (`bash -lc 'gchat post "hi"'`) has argv[0] === "bash", so a
// top-level name check alone would miss it — we recurse into the inline script.
const SHELL_INTERPRETERS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash", "fish"])
const MAX_WRAPPER_DEPTH = 3

/** True if the token list has a shell inline-script flag: -c, -lc, -ic, -lic, ... */
function hasInlineScriptFlag(tokens: string[]): boolean {
  return tokens.some((t) => /^-[a-z]*c[a-z]*$/i.test(t))
}

/** The inline script a shell wrapper would run: the first quoted segment, else the
 *  tokens following the -c-family flag when the script is unquoted. */
function extractInlineScript(commandText: string, tokens: string[]): string | null {
  const quoted = commandText.match(/'([^']*)'|"([^"]*)"/)
  if (quoted) {
    const value = quoted[1] ?? quoted[2] ?? ""
    if (value.trim()) return value
  }
  const flagIdx = tokens.findIndex((t) => /^-[a-z]*c[a-z]*$/i.test(t))
  if (flagIdx >= 0 && flagIdx + 1 < tokens.length) {
    const rest = tokens.slice(flagIdx + 1).join(" ").trim()
    if (rest) return rest
  }
  return null
}

/** Split a shell script into its top-level command segments (best-effort) so comms
 *  intent is caught even when it is not the first command (`ls; gchat post ...`). */
function splitShellSegments(script: string): string[] {
  return script
    .split(/[\n;]|&&|\|\||[|&]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Mirrors AFS work_assistant.communication_preflight's approval_guardrail.policy so
// the confirmation carries the same contract without a shell round-trip. (The AFS
// CLI preflight is session-level guidance, not a per-draft scorer, so it does not
// belong in this latency-sensitive permission path.)
export const POLICY =
  "Outward comms require explicit approval. Do not post, send, submit, or edit an " +
  "external system on the user's behalf without confirming the exact target, action, and preview."

/** The program a single command actually runs: basename of argv[0], skipping leading
 *  `VAR=val` assignments and wrappers like sudo/env. Lowercased. */
export function commandName(commandText: string): string {
  const tokens = commandText.trim().split(/\s+/)
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[A-Za-z_]\w*=/.test(t)) {
      i++
      continue
    } // FOO=bar
    if (LEADING_WRAPPERS.has(t)) {
      i++
      continue
    }
    break
  }
  const raw = tokens[i] ?? ""
  return (raw.split(/[\\/]/).pop() ?? "").toLowerCase()
}

/** Comms channel for a single command, or null if it is not an outward-comms command.
 *  Recurses (bounded) into shell wrapper inline scripts so a comms command cannot hide
 *  behind `bash -lc '...'`. */
export function detectCommand(commandText: string, depth = 0): string | null {
  const cmd = commandName(commandText)
  if (cmd in COMMS_BINARIES) return COMMS_BINARIES[cmd]

  const tokens = commandText.trim().split(/\s+/)
  // `chat send ...` — the `chat` CLI with a send subcommand.
  if (cmd === "chat" && tokens.slice(1, 4).includes("send")) return "Chat send"
  // curl, but only when it targets a known chat/webhook endpoint.
  if (cmd === "curl" && WEBHOOK_URL.test(commandText)) return "Webhook (curl)"
  // Defense in depth: an agent trying to self-approve/execute an AFS work approval
  // from the shell (the AFS CLI hole is hardened separately in Phase 1c).
  if (cmd === "afs" && /\bapprovals?\b/.test(commandText) && /\b(approve|execute)\b/.test(commandText))
    return "AFS approval execute"

  // Shell wrapper (`bash -lc 'gchat post "hi"'`, `sh -c 'ls; gchat send'`): the
  // top-level name is a shell, so scan the inline script's own commands. Bounded
  // recursion guards against nested wrappers without unbounded work.
  if (depth < MAX_WRAPPER_DEPTH && SHELL_INTERPRETERS.has(cmd) && hasInlineScriptFlag(tokens)) {
    const inner = extractInlineScript(commandText, tokens)
    if (inner) {
      for (const segment of splitShellSegments(inner)) {
        const channel = detectCommand(segment, depth + 1)
        if (channel) return channel
      }
    }
  }
  return null
}

/** First matching comms channel across the parsed commands of a bash request. */
export function detectComms(patterns: string[]): { channel: string } | null {
  for (const pattern of patterns) {
    const channel = detectCommand(pattern)
    if (channel) return { channel }
  }
  return null
}

/** The inline script of a shell wrapper, or null if the command is not one. */
function unwrapShell(commandText: string): string | null {
  const cmd = commandName(commandText)
  if (!SHELL_INTERPRETERS.has(cmd)) return null
  const tokens = commandText.trim().split(/\s+/)
  if (!hasInlineScriptFlag(tokens)) return null
  return extractInlineScript(commandText, tokens)
}

/**
 * Best-effort extraction of the message a comms command would send, for preview in
 * the confirmation dialog. Heuristic by design; on failure the caller still asks and
 * shows the raw command (fail-safe, never fail-open).
 */
export function extractDraft(command: string): string | null {
  // Peel shell wrappers first so the preview is the actual message, not the enclosing
  // `bash -lc '...'` (whose outermost quotes would otherwise look like the body).
  let text = command
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH; depth++) {
    const inner = unwrapShell(text)
    if (!inner || inner === text) break
    text = inner
  }

  // 1) Explicit message flags win.
  const flag = text.match(/(?:--message|--msg|--text|--body|-m)[=\s]+("([^"]*)"|'([^']*)'|(\S+))/)
  if (flag) {
    const value = (flag[2] ?? flag[3] ?? flag[4] ?? "").trim()
    if (value) return value
  }
  // 2) Heredoc body.
  const heredoc = text.match(/<<-?\s*['"]?([A-Za-z_]\w*)['"]?\r?\n([\s\S]*?)\r?\n\1\b/)
  if (heredoc) {
    const value = heredoc[2].trim()
    if (value) return value
  }
  // 3) Longest quoted string — most likely the message body.
  const quotes = [...text.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? "")
  if (quotes.length) {
    const longest = quotes.reduce((a, b) => (b.length > a.length ? b : a), "")
    if (longest.trim()) return longest.trim()
  }
  return null
}
