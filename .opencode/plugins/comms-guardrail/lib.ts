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

/** Comms channel for a single command, or null if it is not an outward-comms command. */
export function detectCommand(commandText: string): string | null {
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

/**
 * Best-effort extraction of the message a comms command would send, for preview in
 * the confirmation dialog. Heuristic by design; on failure the caller still asks and
 * shows the raw command (fail-safe, never fail-open).
 */
export function extractDraft(command: string): string | null {
  // 1) Explicit message flags win.
  const flag = command.match(/(?:--message|--msg|--text|--body|-m)[=\s]+("([^"]*)"|'([^']*)'|(\S+))/)
  if (flag) {
    const value = (flag[2] ?? flag[3] ?? flag[4] ?? "").trim()
    if (value) return value
  }
  // 2) Heredoc body.
  const heredoc = command.match(/<<-?\s*['"]?([A-Za-z_]\w*)['"]?\r?\n([\s\S]*?)\r?\n\1\b/)
  if (heredoc) {
    const value = heredoc[2].trim()
    if (value) return value
  }
  // 3) Longest quoted string — most likely the message body.
  const quotes = [...command.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? "")
  if (quotes.length) {
    const longest = quotes.reduce((a, b) => (b.length > a.length ? b : a), "")
    if (longest.trim()) return longest.trim()
  }
  return null
}
