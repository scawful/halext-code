import type { Plugin } from "@opencode-ai/plugin"

const CACHE_LIMIT = 64
const CACHE_MS = 120_000
const FAILURE_CACHE_MS = 15_000
const OUTPUT_LIMIT = 24 * 1024
const TIMEOUT_MS = 8_000

const SCOPED_TOOLS = [
  "context_status",
  "context_query",
  "context_search",
  "context_read",
  "context_write",
  "context_list",
  "messages_send",
  "messages_read",
  "note_create",
  "note_read",
  "note_list",
  "handoff_create",
  "handoff_read",
  "handoff_list",
]

const SYSTEM_GUIDANCE = [
  "AFS is an optional workspace-context layer; repository policy and the user's request take precedence.",
  "Start with the AFS context.status or context.query tool, then use context.read or context.list only for relevant follow-up.",
  "Treat scratchpad as the default writable area. Update memory or knowledge only when the user deliberately requests durable state.",
  "Use /afs for the smallest useful route; /afs/status, /afs/verify, /afs/handoff, and /afs/repair are focused routes.",
  "Do not start background agents, embeddings, repair, or session-pack work merely because those features exist.",
  "Use the model and provider selected by OpenCode configuration. Do not infer a provider, model, context root, or machine layout from this repository.",
]

type RunOptions = {
  cwd: string
  timeout?: number
  limit?: number
}

export async function runBounded(command: string[], options: RunOptions) {
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })
  const timeout = options.timeout ?? TIMEOUT_MS
  const limit = options.limit ?? OUTPUT_LIMIT
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    process.kill()
  }, timeout)
  const output = readBounded(process.stdout, limit)
  void output.then((value) => {
    if (value.truncated) process.kill()
  })
  const [value, exitCode] = await Promise.all([output, process.exited])
  clearTimeout(timer)
  if (timedOut || value.truncated || exitCode !== 0) return null
  return value.text.trim()
}

export function isAFSProjectScopedTool(tool: string, serverName = process.env.AFS_MCP_SERVER_NAME || "afs") {
  const prefix = serverName.trim().replace(/[^a-zA-Z0-9_-]/g, "_") + "_"
  return SCOPED_TOOLS.some((name) => tool === prefix + name)
}

export const AFSContextPlugin: Plugin = async (input, options) => {
  const serverName = typeof options?.serverName === "string" ? options.serverName : undefined
  const binary = process.env.AFS_BIN?.trim() || process.env.AFS_CLI?.trim() || "afs"
  const grounding = new Map<string, { text: string; until: number }>()
  const pending = new Map<string, Promise<string | null>>()

  const loadGrounding = (sessionID: string) => {
    const cached = grounding.get(sessionID)
    if (cached?.until && cached.until > Date.now()) return Promise.resolve(cached.text || null)
    const active = pending.get(sessionID)
    if (active) return active
    if (pending.size >= CACHE_LIMIT) return Promise.resolve(null)

    const task = runBounded([binary, "session", "context", "--path", input.directory, "--no-skills"], {
      cwd: input.directory,
    })
      .catch(() => null)
      .then((text) => {
        pending.delete(sessionID)
        grounding.delete(sessionID)
        grounding.set(sessionID, {
          text: text ?? "",
          until: Date.now() + (text === null ? FAILURE_CACHE_MS : CACHE_MS),
        })
        while (grounding.size > CACHE_LIMIT) grounding.delete(grounding.keys().next().value!)
        return text
      })
    pending.set(sessionID, task)
    return task
  }

  return {
    "experimental.chat.system.transform": async (hook, output) => {
      output.system.push(SYSTEM_GUIDANCE.join("\n"))
      const sessionID = hook.sessionID?.trim()
      if (!sessionID) return
      const text = await loadGrounding(sessionID)
      if (text) output.system.push(text)
    },
    "tool.execute.before": async (hook, output) => {
      if (!isAFSProjectScopedTool(hook.tool, serverName)) return
      const args = output.args as Record<string, unknown>
      args.project_path = input.directory
    },
  }
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false

  // A controlled AFS command should stay small, but the plugin still treats
  // its executable as an external process and enforces a hard read boundary.
  for (;;) {
    const value = await reader.read()
    if (value.done) break
    const remaining = limit - size
    if (value.value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.value.subarray(0, remaining))
      size += Math.max(remaining, 0)
      truncated = true
      await reader.cancel()
      break
    }
    chunks.push(value.value)
    size += value.value.byteLength
  }

  const bytes = new Uint8Array(size)
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset)
    return offset + chunk.byteLength
  }, 0)
  return { text: new TextDecoder().decode(bytes), truncated }
}

export default AFSContextPlugin
