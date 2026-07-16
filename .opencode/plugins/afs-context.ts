import { existsSync } from "fs"
import { isAbsolute, join } from "path"
import type { Plugin } from "@opencode-ai/plugin"
import { run } from "./afs-context/lib"

const CACHE_LIMIT = 32
const OUTPUT_LIMIT = 32 * 1024
const RETRY_MS = 30_000
const TIMEOUT_MS = 10_000

const TOOLS = new Set([
  "afs_local_context_mount",
  "afs_local_context_unmount",
  "afs_local_context_index_rebuild",
  "afs_local_context_query",
  "afs_local_context_diff",
  "afs_local_context_status",
  "afs_local_session_pack",
  "afs_local_context_repair",
  "afs_local_agent_logs",
  "afs_local_hivemind_send",
  "afs_local_hivemind_read",
  "afs_local_task_create",
  "afs_local_task_list",
  "afs_local_task_claim",
  "afs_local_task_complete",
  "afs_local_events_analytics",
  "afs_local_events_replay",
  "afs_local_hivemind_subscribe",
  "afs_local_hivemind_unsubscribe",
  "afs_local_hivemind_reap",
  "afs_local_handoff_create",
  "afs_local_handoff_read",
  "afs_local_handoff_list",
  "afs_local_hivemind_cleanup",
  "afs_local_memory_status",
  "afs_local_memory_search",
  "afs_local_context_freshness",
  "afs_local_session_replay",
])

const FILES = new Set([
  "afs_local_context_read",
  "afs_local_context_write",
  "afs_local_context_delete",
  "afs_local_context_move",
  "afs_local_context_list",
])

const MOUNTS = new Set([
  "scratchpad",
  "memory",
  "knowledge",
  "hivemind",
  "items",
  "global",
  "history",
  "tools",
  "monorepo",
])

const SYSTEM_GUIDANCE = [
  "This workspace uses Python AFS through the afs_local_* MCP tools.",
  "Treat AFS as quiet workspace support by default, not as a foreground workflow.",
  "When unsure which AFS surface to use, route first through /afs-next or `~/src/lab/afs/scripts/afs next --path . --intent <intent> --json`.",
  "Use short workflow aliases when they fit: /start, /find, /check, /ship, /reply, /handoff, /fixafs, and /setupafs.",
  "Use the deterministic AFS discovery ladder: status -> query -> exact read/list -> scratchpad write -> named CLI/slash-command flow.",
  "The default AFS MCP catalog is intentionally slim: afs_local_context_status, afs_local_context_query, afs_local_context_read, afs_local_context_write, and afs_local_context_list.",
  "Do not assume context.diff, context.freshness, task.*, handoff.*, memory.*, work.*, repair, or session.pack MCP tools are exposed in normal hcode sessions.",
  "Prefer repo-local slash commands for richer AFS intents: /afs-next, /afs-brief, /afs-help, /afs-status, /afs-query, /afs-files, /afs-tasks, /afs-handoff, /afs-handoff-create, /afs-review-context, /afs-work-preflight, /afs-verify, /afs-refresh, /afs-pack, and /afs-update-work.",
  "Prefer visible AFS role agents sparingly: @afs-context for context lookup, @afs-planner for plans, @afs-reviewer for findings, @afs-worker for execution, and @critic for a strict second pass.",
  "Specialized exact-name agents exist for advanced flows, but normal agents should prefer slash commands over browsing a larger AFS catalog.",
  "Worker-style agents may read or write repo-local .context files, but should keep default writes in scratchpad and route task/handoff/work/verify/refresh/pack flows through slash commands or the AFS CLI.",
  "Do not call afs_local_session_pack by default. Reserve it for explicit handoff or export requests, or when the user directly asks for a session pack.",
  "If AFS reports a built-but-stale index, treat that as a freshness advisory for search-heavy work, not as a hard failure.",
  "If an AFS tool is slow or times out, report that plainly and fall back to lighter-weight AFS context instead of retrying aggressively.",
]

export const AFSContextPlugin: Plugin = async ({ directory, worktree }) => {
  const base = worktree === "/" ? directory : worktree
  const root = join(base, ".context")

  // Keep successful grounding per session. Failures get a short backoff rather
  // than becoming permanent, and session-less transforms never shell out.
  const grounding = new Map<string, { text: string; retry: number }>()
  const pending = new Map<string, Promise<string | null>>()
  const loadGrounding = async (): Promise<string | null> => {
    if (!existsSync(root)) return null
    const bin = process.env.AFS_BIN?.trim() || process.env.AFS_CLI?.trim() || "afs"
    return run([bin, "claude", "hook", "--raw", "--event", "SessionStart", "--path", base], {
      timeout: TIMEOUT_MS,
      limit: OUTPUT_LIMIT,
    })
  }
  const staleNote =
    "\n\nRepo note: in this workspace, a built-but-stale index is usually a freshness advisory, not a hard failure. If mounts are healthy and the index exists, prefer normal cheap AFS reads and refresh only before search-heavy work."
  const refreshNote =
    "\n\nRepo note: this rebuild targeted the repo-local .context index. A later status may still report stale if mounted sources drift again; treat that as advisory unless mounts are unhealthy or the index is missing."
  const packNote =
    "\n\nRepo note: repeated session-pack calls may reuse the stored pack artifact when the bootstrap snapshot and pack inputs have not changed."
  const fileNote = `For afs_local_context_read/list/write/move/delete, prefer absolute paths under ${root}. The plugin also normalizes common .context/... and mount-relative paths.`
  const fix = (v: unknown) => {
    if (typeof v !== "string") return v
    const path = v.trim()
    if (!path || isAbsolute(path)) return v
    if (path === ".context" || path.startsWith(".context/")) return join(base, path)
    const head = path.split(/[\\/]/, 1)[0] ?? ""
    if (MOUNTS.has(head)) return join(root, path)
    return v
  }

  return {
    "experimental.chat.system.transform": async (input, output) => {
      output.system.push([...SYSTEM_GUIDANCE, fileNote].join("\n"))
      // Push live AFS grounding so context reaches the model without an explicit
      // prompt (pull -> push). Appended, never prepended: llm.ts re-collapses
      // system[1..] and preserves system[0], so the prompt-cache header is intact.
      const sessionID = typeof input?.sessionID === "string" ? input.sessionID.trim() : ""
      if (!sessionID) return
      const cached = grounding.get(sessionID)
      if (cached) {
        grounding.delete(sessionID)
        grounding.set(sessionID, cached)
        if (cached.retry === 0 || cached.retry > Date.now()) {
          if (cached.text) output.system.push(cached.text)
          return
        }
      }

      let task = pending.get(sessionID)
      if (!task) {
        if (pending.size >= CACHE_LIMIT) return
        task = loadGrounding()
          .catch(() => null)
          .then((text) => {
            pending.delete(sessionID)
            grounding.delete(sessionID)
            grounding.set(sessionID, { text: text ?? "", retry: text === null ? Date.now() + RETRY_MS : 0 })
            while (grounding.size > CACHE_LIMIT) grounding.delete(grounding.keys().next().value!)
            return text
          })
        pending.set(sessionID, task)
      }
      const text = await task
      if (text) output.system.push(text)
    },
    "tool.execute.before": async (input, output) => {
      const args = output.args as Record<string, unknown>
      if (TOOLS.has(input.tool)) args.context_path = root
      if (FILES.has(input.tool)) {
        args.path = fix(args.path)
        args.source = fix(args.source)
        args.destination = fix(args.destination)
      }
      if (input.tool === "afs_local_handoff_create") {
        const name = typeof args.agent_name === "string" ? args.agent_name.trim() : ""
        if (!name) args.agent_name = "hcode"
      }
    },
    "tool.execute.after": async (input, output) => {
      if (typeof output.output !== "string") return
      if (input.tool === "afs_local_context_status" && !output.output.includes("Repo note:")) {
        output.output += staleNote
      }
      if (input.tool === "afs_local_context_index_rebuild" && !output.output.includes("Repo note:")) {
        output.output += refreshNote
      }
      if (input.tool === "afs_local_session_pack" && !output.output.includes("Repo note:")) {
        output.output += packNote
      }
    },
  }
}

export default AFSContextPlugin
