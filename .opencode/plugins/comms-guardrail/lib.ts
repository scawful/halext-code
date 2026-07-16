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
const LEADING_WRAPPERS = new Set(["command", "exec", "nice", "nohup", "time", "timeout", "xargs"])

// Interpreters that run an inline script from a `-c`-style flag. A comms command
// hidden inside one (`bash -lc 'gchat post "hi"'`) has argv[0] === "bash", so a
// top-level name check alone would miss it — we recurse into the inline script.
const SHELL_INTERPRETERS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash", "fish"])
const MAX_WRAPPER_DEPTH = 3

type Word = { value: string; start: number }

function shellWords(text: string): Word[] {
  const words: Word[] = []
  let buf = ""
  let quote = ""
  let token = false
  let escape = false
  let start = 0

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (escape) {
      buf += char
      token = true
      escape = false
      continue
    }
    if (char === "\\" && quote !== "'") {
      if (!token) start = index
      escape = true
      token = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ""
      else buf += char
      token = true
      continue
    }
    if (char === "'" || char === '"') {
      if (!token) start = index
      quote = char
      token = true
      continue
    }
    if (/\s/.test(char)) {
      if (token) words.push({ value: buf, start })
      buf = ""
      token = false
      continue
    }
    if (!token) start = index
    buf += char
    token = true
  }
  if (escape) buf += "\\"
  if (token) words.push({ value: buf, start })
  return words
}

function shellTokens(text: string): string[] {
  return shellWords(text).map((word) => word.value)
}

function base(token: string): string {
  return (token.split(/[\\/]/).pop() ?? "").toLowerCase()
}

function skipSudo(tokens: string[], index: number): number {
  let i = index + 1
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === "--") return i + 1
    if (!t.startsWith("-")) break
    if (
      [
        "--user",
        "--group",
        "--host",
        "--prompt",
        "--close-from",
        "--command-timeout",
        "--chdir",
        "--chroot",
        "--other-user",
      ].includes(t)
    ) {
      i += 2
      continue
    }
    if (/^--(?:user|group|host|prompt|close-from|command-timeout|chdir|chroot|other-user)=/.test(t)) {
      i++
      continue
    }
    if (
      t.startsWith("--") &&
      ![
        "--askpass",
        "--background",
        "--bell",
        "--edit",
        "--list",
        "--login",
        "--non-interactive",
        "--preserve-env",
        "--preserve-groups",
        "--remove-timestamp",
        "--reset-timestamp",
        "--set-home",
        "--shell",
        "--stdin",
        "--validate",
        "--version",
      ].includes(t) &&
      !t.startsWith("--preserve-env=")
    ) {
      return tokens.length
    }
    if (t.startsWith("--")) {
      i++
      continue
    }
    const body = t.slice(1)
    let consumed = false
    for (let option = 0; option < body.length; option++) {
      if ("ABbEHikKlnNPSsVv".includes(body[option])) continue
      if (!"CDghpRTuU".includes(body[option])) return tokens.length
      i += option + 1 < body.length ? 1 : 2
      consumed = true
      break
    }
    if (!consumed) i++
  }
  return i
}

function skipEnv(tokens: string[], index: number): number {
  let i = index + 1
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[A-Za-z_]\w*=/.test(t)) {
      i++
      continue
    }
    if (t === "--") return i + 1
    if (!t.startsWith("-")) break
    if (["--unset", "--split-string", "--chdir", "--argv0"].includes(t)) {
      i += 2
      continue
    }
    if (/^--(?:unset|split-string|chdir|argv0)=/.test(t)) {
      i++
      continue
    }
    if (
      t.startsWith("--") &&
      ![
        "--block-signal",
        "--debug",
        "--default-signal",
        "--ignore-environment",
        "--ignore-signal",
        "--list-signal-handling",
        "--null",
      ].includes(t) &&
      !/^--(?:block-signal|default-signal|ignore-signal)=/.test(t)
    ) {
      return tokens.length
    }
    if (t.startsWith("--")) {
      i++
      continue
    }
    const body = t.slice(1)
    let consumed = false
    for (let option = 0; option < body.length; option++) {
      if ("0iv".includes(body[option])) continue
      if (!"aCPSu".includes(body[option])) return tokens.length
      i += option + 1 < body.length ? 1 : 2
      consumed = true
      break
    }
    if (!consumed) i++
  }
  return i
}

function skipShort(tokens: string[], index: number, values: string, flags: string): number | null {
  const body = tokens[index].slice(1)
  if (!body) return null
  for (let i = 0; i < body.length; i++) {
    if (flags.includes(body[i])) continue
    if (!values.includes(body[i])) return null
    return i + 1 < body.length ? index + 1 : index + 2
  }
  return index + 1
}

function skipWrapper(tokens: string[], index: number, cmd: string): number {
  let i = index + 1
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === "--") return cmd === "timeout" ? i + 2 : i + 1
    if (!token.startsWith("-") || token === "-") return cmd === "timeout" ? i + 1 : i

    if (cmd === "command") {
      if (!/^-[pVv]+$/.test(token) || /[Vv]/.test(token)) return tokens.length
      i++
      continue
    }

    if (cmd === "nohup") {
      // GNU/coreutils nohup has no command-line flags beyond `--`; help/version
      // exit without running the following token.
      return tokens.length
    }

    if (cmd === "exec") {
      if (token === "--help" || token === "--version") return tokens.length
      const next = skipShort(tokens, i, "a", "cl")
      if (next === null) return tokens.length
      i = next
      continue
    }

    if (cmd === "time") {
      if (token === "--help" || token === "--version") return tokens.length
      if (["--format", "--output"].includes(token)) {
        i += 2
        continue
      }
      if (/^--(?:format|output)=/.test(token)) {
        i++
        continue
      }
      if (["--append", "--portability", "--quiet", "--verbose"].includes(token)) {
        i++
        continue
      }
      const next = skipShort(tokens, i, "fo", "ahlpqv")
      if (next === null) return tokens.length
      i = next
      continue
    }

    if (cmd === "timeout") {
      if (token === "--help" || token === "--version") return tokens.length
      if (["--signal", "--kill-after"].includes(token)) {
        i += 2
        continue
      }
      if (/^--(?:signal|kill-after)=/.test(token)) {
        i++
        continue
      }
      if (["--preserve-status", "--foreground", "--verbose"].includes(token)) {
        i++
        continue
      }
      const next = skipShort(tokens, i, "ks", "v")
      if (next === null) return tokens.length
      i = next
      continue
    }

    if (cmd === "nice") {
      if (token === "--help" || token === "--version") return tokens.length
      if (token === "--adjustment") {
        i += 2
        continue
      }
      if (/^--adjustment=/.test(token) || /^-\d+$/.test(token)) {
        i++
        continue
      }
      const next = skipShort(tokens, i, "n", "")
      if (next === null) return tokens.length
      i = next
      continue
    }

    if (cmd === "xargs") {
      if (token === "--help" || token === "--version") return tokens.length
      if (
        ["--arg-file", "--delimiter", "--max-args", "--max-procs", "--max-chars", "--process-slot-var"].includes(token)
      ) {
        i += 2
        continue
      }
      if (
        /^--(?:arg-file|delimiter|eof|replace|max-lines|max-args|max-procs|max-chars|process-slot-var)=/.test(token)
      ) {
        i++
        continue
      }
      if (
        [
          "--eof",
          "--replace",
          "--max-lines",
          "--null",
          "--exit",
          "--interactive",
          "--no-run-if-empty",
          "--open-tty",
          "--show-limits",
          "--verbose",
        ].includes(token)
      ) {
        i++
        continue
      }
      // GNU's legacy -e/-i/-l forms take an optional attached value. A
      // following token is the command, not the option operand.
      if (/^-[eil]/.test(token)) {
        i++
        continue
      }
      const next = skipShort(tokens, i, "adEIJLnOPRSs", "0oprtx")
      if (next === null) return tokens.length
      i = next
      continue
    }
  }
  return i
}

type CommandResolution = { index: number; splitString?: string }

function envSplitString(tokens: string[], index: number): string | null {
  const withTail = (value: string | undefined, next: number) => {
    const split = value?.trim()
    if (!split) return null
    return [split, ...tokens.slice(next).map((token) => JSON.stringify(token))].join(" ")
  }
  let i = index + 1
  while (i < tokens.length) {
    const token = tokens[i]
    if (/^[A-Za-z_]\w*=/.test(token)) {
      i++
      continue
    }
    if (token === "--") return null
    if (token === "-S" || token === "--split-string") return withTail(tokens[i + 1], i + 2)
    if (token.startsWith("--split-string=")) return withTail(token.slice("--split-string=".length), i + 1)
    if (token.startsWith("-S") && token.length > 2) return withTail(token.slice(2), i + 1)
    if (["--unset", "--chdir", "--argv0"].includes(token)) {
      i += 2
      continue
    }
    if (/^--(?:unset|chdir|argv0)=/.test(token)) {
      i++
      continue
    }
    if (/^--(?:block-signal|default-signal|ignore-signal)(?:=.*)?$/.test(token) || token === "--list-signal-handling") {
      i++
      continue
    }
    if (!token.startsWith("-") || token === "-") return null
    const body = token.slice(1)
    let consumed = false
    for (let option = 0; option < body.length; option++) {
      const name = body[option]
      if (name === "S") {
        const attached = body.slice(option + 1)
        return attached ? withTail(attached, i + 1) : withTail(tokens[i + 1], i + 2)
      }
      if ("0iv".includes(name)) continue
      if (!"aCPu".includes(name)) return null
      i += option + 1 < body.length ? 1 : 2
      consumed = true
      break
    }
    if (!consumed) i++
  }
  return null
}

function resolveCommand(tokens: string[]): CommandResolution {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[A-Za-z_]\w*=/.test(t)) {
      i++
      continue
    }
    const cmd = base(t)
    if (cmd === "sudo") {
      i = skipSudo(tokens, i)
      continue
    }
    if (cmd === "env") {
      const splitString = envSplitString(tokens, i)
      if (splitString) return { index: tokens.length, splitString }
      i = skipEnv(tokens, i)
      continue
    }
    if (LEADING_WRAPPERS.has(cmd)) {
      i = skipWrapper(tokens, i, cmd)
      continue
    }
    break
  }
  return { index: i }
}

function commandIndex(tokens: string[]): number {
  return resolveCommand(tokens).index
}

/** True if the token list has a shell inline-script flag: -c, -lc, -ic, -lic, ... */
function hasInlineScriptFlag(tokens: string[]): boolean {
  return tokens.some((t) => /^-[a-z]*c[a-z]*$/i.test(t))
}

/** The inline script a shell wrapper would run: the token following the -c flag. */
function extractInlineScript(tokens: string[]): string | null {
  const flagIdx = tokens.findIndex((t) => /^-[a-z]*c[a-z]*$/i.test(t))
  if (flagIdx >= 0 && flagIdx + 1 < tokens.length) {
    const index = tokens[flagIdx + 1] === "--" ? flagIdx + 2 : flagIdx + 1
    const script = (tokens[index] ?? "").trim()
    if (script) return script
  }
  return null
}

/** Split a shell script into its top-level command segments (best-effort) so comms
 *  intent is caught even when it is not the first command (`ls; gchat post ...`). */
function splitShellSegments(script: string): string[] {
  const segments: string[] = []
  let buf = ""
  let quote = ""
  let escape = false
  const push = () => {
    const value = buf.trim()
    if (value) segments.push(value)
    buf = ""
  }
  for (let index = 0; index < script.length; index++) {
    const char = script[index]
    if (escape) {
      buf += char
      escape = false
      continue
    }
    if (char === "\\" && quote !== "'") {
      buf += char
      escape = true
      continue
    }
    if (quote) {
      buf += char
      if (char === quote) quote = ""
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      buf += char
      continue
    }
    if (char === "\n" || char === ";" || char === "|" || char === "&") {
      push()
      if ((char === "|" || char === "&") && script[index + 1] === char) index++
      continue
    }
    buf += char
  }
  push()
  return segments
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
export function commandName(commandText: string, depth = 0): string {
  const tokens = shellTokens(commandText)
  const resolved = resolveCommand(tokens)
  if (resolved.splitString && depth < MAX_WRAPPER_DEPTH) return commandName(`env ${resolved.splitString}`, depth + 1)
  return base(tokens[resolved.index] ?? "")
}

export type CommsMatch = { channel: string; command: string; payload: string }

// Invert curl parsing: known switches do not consume argv, while every other
// option is treated as value-bearing. This is safer than an inevitably incomplete
// list of value options: a new/unknown option value cannot masquerade as a target.
const CURL_LONG_FLAGS = new Set([
  "--anyauth",
  "--append",
  "--basic",
  "--ca-native",
  "--cert-status",
  "--compressed",
  "--compressed-ssh",
  "--create-dirs",
  "--crlf",
  "--digest",
  "--disable",
  "--disable-eprt",
  "--disable-epsv",
  "--disallow-username-in-url",
  "--doh-cert-status",
  "--doh-insecure",
  "--fail",
  "--fail-early",
  "--fail-with-body",
  "--false-start",
  "--form-escape",
  "--ftp-create-dirs",
  "--ftp-pasv",
  "--ftp-pret",
  "--ftp-skip-pasv-ip",
  "--ftp-ssl-ccc",
  "--ftp-ssl-control",
  "--get",
  "--globoff",
  "--haproxy-protocol",
  "--head",
  "--http0.9",
  "--http1.0",
  "--http1.1",
  "--http2",
  "--http2-prior-knowledge",
  "--http3",
  "--http3-only",
  "--ignore-content-length",
  "--include",
  "--insecure",
  "--ipv4",
  "--ipv6",
  "--junk-session-cookies",
  "--list-only",
  "--location",
  "--location-trusted",
  "--mail-rcpt-allowfails",
  "--manual",
  "--metalink",
  "--negotiate",
  "--netrc",
  "--netrc-optional",
  "--next",
  "--no-alpn",
  "--no-buffer",
  "--no-clobber",
  "--no-keepalive",
  "--no-npn",
  "--no-progress-meter",
  "--no-sessionid",
  "--ntlm",
  "--ntlm-wb",
  "--parallel",
  "--parallel-immediate",
  "--path-as-is",
  "--post301",
  "--post302",
  "--post303",
  "--progress-bar",
  "--proxy-anyauth",
  "--proxy-basic",
  "--proxy-ca-native",
  "--proxy-digest",
  "--proxy-http2",
  "--proxy-insecure",
  "--proxy-negotiate",
  "--proxy-ntlm",
  "--proxy-ssl-allow-beast",
  "--proxy-ssl-auto-client-cert",
  "--proxy-tlsv1",
  "--proxytunnel",
  "--raw",
  "--remote-header-name",
  "--remote-name",
  "--remote-name-all",
  "--remote-time",
  "--remove-on-error",
  "--retry-all-errors",
  "--retry-connrefused",
  "--sasl-ir",
  "--show-error",
  "--silent",
  "--socks5-basic",
  "--socks5-gssapi",
  "--socks5-gssapi-nec",
  "--ssl",
  "--ssl-allow-beast",
  "--ssl-auto-client-cert",
  "--ssl-no-revoke",
  "--ssl-reqd",
  "--ssl-revoke-best-effort",
  "--sslv2",
  "--sslv3",
  "--styled-output",
  "--suppress-connect-headers",
  "--tcp-fastopen",
  "--tcp-nodelay",
  "--tftp-no-options",
  "--tlsv1",
  "--tlsv1.0",
  "--tlsv1.1",
  "--tlsv1.2",
  "--tlsv1.3",
  "--tr-encoding",
  "--trace-ids",
  "--trace-time",
  "--use-ascii",
  "--verbose",
  "--version",
  "--xattr",
])
const CURL_SHORT_FLAGS = new Set("#012346:BaBfGgIiJjkLlMnNOpqRsSvVZ".split(""))

function curlLongFlag(token: string): boolean {
  if (CURL_LONG_FLAGS.has(token)) return true
  const name = token.slice(2)
  // curl accepts an implicit inverse spelling for every boolean long option.
  // This handles --no-location as well as the inverse of canonical --no-* names.
  return (name.startsWith("no-") && CURL_LONG_FLAGS.has(`--${name.slice(3)}`)) || CURL_LONG_FLAGS.has(`--no-${name}`)
}

function curlTargets(args: string[]): string[] {
  const targets: string[] = []
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === "--") {
      targets.push(...args.slice(i + 1))
      break
    }
    if (token === "--url") {
      if (args[i + 1]) targets.push(args[++i])
      continue
    }
    if (token.startsWith("--url=")) {
      targets.push(token.slice("--url=".length))
      continue
    }
    if (token.startsWith("--")) {
      if (!token.includes("=") && !curlLongFlag(token)) i++
      continue
    }
    if (token.startsWith("-") && token !== "-") {
      const body = token.slice(1)
      const valueAt = [...body].findIndex((option) => !CURL_SHORT_FLAGS.has(option))
      if (valueAt >= 0 && valueAt === body.length - 1) i++
      continue
    }
    targets.push(token)
  }
  return targets
}

/** Best-effort, bounded match for a literal command. Dynamic shell expansion and
 *  commands loaded from scripts are intentionally outside this detector's scope. */
function matchCommand(commandText: string, depth = 0): CommsMatch | null {
  const words = shellWords(commandText)
  const tokens = words.map((word) => word.value)
  const resolved = resolveCommand(tokens)
  const command = commandText.trim()
  if (resolved.splitString && depth < MAX_WRAPPER_DEPTH) {
    const nested = matchCommand(`env ${resolved.splitString}`, depth + 1)
    return nested ? { ...nested, command } : null
  }
  const index = resolved.index
  const cmd = base(tokens[index] ?? "")
  const payload = commandText.slice(words[index]?.start ?? 0).trim()
  const match = (channel: string): CommsMatch => ({ channel, command, payload })
  if (cmd in COMMS_BINARIES) return match(COMMS_BINARIES[cmd])

  const args = tokens.slice(index + 1)
  // `chat send ...` — the `chat` CLI with a send subcommand.
  if (cmd === "chat" && args.slice(0, 3).includes("send")) return match("Chat send")
  // curl, but only when it targets a known chat/webhook endpoint.
  if (cmd === "curl" && curlTargets(args).some((target) => WEBHOOK_URL.test(target))) return match("Webhook (curl)")
  // Defense in depth: an agent trying to self-approve/execute an AFS work approval
  // from the shell (the AFS CLI hole is hardened separately in Phase 1c).
  if (
    cmd === "afs" &&
    args.some((arg) => /^approvals?$/.test(arg)) &&
    args.some((arg) => /^(approve|execute)$/.test(arg))
  )
    return match("AFS approval execute")

  // Shell wrapper (`bash -lc 'gchat post "hi"'`, `sh -c 'ls; gchat send'`): the
  // top-level name is a shell, so scan the inline script's own commands. Bounded
  // recursion guards against nested wrappers without unbounded work.
  if (depth < MAX_WRAPPER_DEPTH && SHELL_INTERPRETERS.has(cmd) && hasInlineScriptFlag(tokens)) {
    const inner = extractInlineScript(tokens)
    if (inner) {
      for (const segment of splitShellSegments(inner)) {
        const nested = matchCommand(segment, depth + 1)
        if (nested) return { ...nested, command }
      }
    }
  }
  return null
}

/** Comms channel for a single literal command, or null when none is recognized. */
export function detectCommand(commandText: string, depth = 0): string | null {
  return matchCommand(commandText, depth)?.channel ?? null
}

/** First matched literal command across the parsed commands of a bash request. */
export function detectComms(patterns: string[]): CommsMatch | null {
  for (const pattern of patterns) {
    const match = matchCommand(pattern)
    if (match) return match
  }
  return null
}

/** The inline script of a shell wrapper, or null if the command is not one. */
function unwrapShell(commandText: string): string | null {
  const cmd = commandName(commandText)
  if (!SHELL_INTERPRETERS.has(cmd)) return null
  const tokens = shellTokens(commandText)
  if (!hasInlineScriptFlag(tokens)) return null
  return extractInlineScript(tokens)
}

function optionValues(args: string[], long: string[], short: string[]): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index++) {
    const token = args[index]
    if (long.includes(token) || short.includes(token)) {
      const value = args[++index]?.trim()
      if (value) values.push(value)
      continue
    }
    for (const name of long) {
      if (token.startsWith(`${name}=`)) {
        const value = token.slice(name.length + 1).trim()
        if (value) values.push(value)
      }
    }
    for (const name of short) {
      if (token.startsWith(name) && token.length > name.length) {
        const value = token.slice(name.length).replace(/^=/, "").trim()
        if (value) values.push(value)
      }
    }
  }
  return values
}

function optionValue(args: string[], long: string[], short: string[]): string | null {
  return optionValues(args, long, short)[0] ?? null
}

function positionalChatDraft(args: string[]): string | null {
  if (!["post", "send", "message"].includes(args[0] ?? "")) return null

  const targetOptions = new Set([
    "--channel",
    "--format",
    "--room",
    "--space",
    "--target",
    "--thread",
    "--thread-key",
    "--type",
  ])
  const positional: string[] = []
  for (let index = 1; index < args.length; index++) {
    const token = args[index]
    if (targetOptions.has(token)) {
      index++
      continue
    }
    if ([...targetOptions].some((option) => token.startsWith(`${option}=`))) continue
    // Unknown options make positional interpretation ambiguous. The permission
    // prompt still shows the full command, so fail closed rather than label an
    // option operand as the message body.
    if (token.startsWith("-")) return null
    positional.push(token)
  }
  return positional.at(-1)?.trim() || null
}

/**
 * Best-effort extraction of the message a comms command would send, for preview in
 * the confirmation dialog. Extraction is command-aware so destinations and headers
 * are never guessed to be drafts. On failure the caller still asks and shows the raw
 * command (fail-safe, never fail-open).
 */
export function extractDraft(command: string, depth = 0): string | null {
  // Peel shell wrappers first so the preview is the actual message, not the enclosing
  // `bash -lc '...'` (whose outermost quotes would otherwise look like the body).
  let text = command
  for (let level = depth; level < MAX_WRAPPER_DEPTH; level++) {
    const inner = unwrapShell(text)
    if (!inner || inner === text) break
    text = inner
  }

  const words = shellWords(text)
  const tokens = words.map((word) => word.value)
  const resolved = resolveCommand(tokens)
  if (resolved.splitString && depth < MAX_WRAPPER_DEPTH) return extractDraft(`env ${resolved.splitString}`, depth + 1)
  const cmd = base(tokens[resolved.index] ?? "")
  const args = tokens.slice(resolved.index + 1)

  // Heredocs carry an explicit body independent of command-specific argv rules.
  const heredoc = text.match(/<<-?\s*['"]?([A-Za-z_]\w*)['"]?\r?\n([\s\S]*?)\r?\n\1\b/)
  if (heredoc) {
    const value = heredoc[2].trim()
    if (value) return value
  }

  if (cmd === "curl") {
    const data = optionValues(
      args,
      ["--data", "--data-ascii", "--data-binary", "--data-raw", "--data-urlencode", "--json"],
      ["-d"],
    )
    const at = data[0]?.indexOf("@") ?? -1
    const equals = data[0]?.indexOf("=") ?? -1
    if (data.length !== 1 || (at >= 0 && (equals < 0 || at < equals))) return null
    return data[0]
  }

  if (cmd === "gchat" || cmd === "chat") {
    const explicit = optionValue(args, ["--message", "--msg", "--text", "--body"], ["-m"])
    if (explicit) return explicit
    const send = args.indexOf("send")
    if (cmd === "chat" && send < 0) return null
    const action = cmd === "chat" ? args.slice(send) : args
    return positionalChatDraft(action)
  }

  return null
}
