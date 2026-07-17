import type { Plugin } from "@opencode-ai/plugin"
import { run } from "./afs-context/lib"
import { path, project, type Project } from "./afs-context/project"

const CACHE_LIMIT = 32
const OUTPUT_LIMIT = 32 * 1024
const RETRY_MS = 30_000
const TIMEOUT_MS = 10_000

const TOOLS = new Set([
  "afs_local_context_mount",
  "afs_local_context_unmount",
  "afs_local_context_index_rebuild",
  "afs_local_context_query",
  "afs_local_context_search",
  "afs_local_context_diff",
  "afs_local_context_status",
  "afs_local_session_pack",
  "afs_local_context_repair",
  "afs_local_agent_logs",
  "afs_local_hivemind_send",
  "afs_local_hivemind_read",
  "afs_local_messages_send",
  "afs_local_messages_read",
  "afs_local_task_create",
  "afs_local_task_list",
  "afs_local_task_claim",
  "afs_local_task_complete",
  "afs_local_events_analytics",
  "afs_local_events_replay",
  "afs_local_hivemind_subscribe",
  "afs_local_hivemind_unsubscribe",
  "afs_local_hivemind_reap",
  "afs_local_messages_subscribe",
  "afs_local_messages_unsubscribe",
  "afs_local_messages_clean",
  "afs_local_note_create",
  "afs_local_note_read",
  "afs_local_note_list",
  "afs_local_handoff_create",
  "afs_local_handoff_revise",
  "afs_local_handoff_read",
  "afs_local_handoff_list",
  "afs_local_handoff_threads",
  "afs_local_handoff_ack",
  "afs_local_handoff_close",
  "afs_local_hivemind_cleanup",
  "afs_local_memory_status",
  "afs_local_memory_search",
  "afs_local_context_freshness",
  "afs_local_session_replay",
])

const FILES = new Set([
  "afs_local_fs_read",
  "afs_local_fs_write",
  "afs_local_fs_delete",
  "afs_local_fs_move",
  "afs_local_fs_list",
  "afs_local_context_read",
  "afs_local_context_write",
  "afs_local_context_delete",
  "afs_local_context_move",
  "afs_local_context_list",
])

const SYSTEM_GUIDANCE = [
  "This workspace uses Python AFS through the afs_local_* MCP tools.",
  "Treat AFS as quiet workspace support by default, not as a foreground workflow.",
  'Start or resume scoped work with `"${AFS_BIN:-${AFS_CLI:-afs}}" start --path .`; use /afs-next only when an older AFS install lacks the friendly commands.',
  "Use short workflow aliases when they fit: /start, /find, /check, /ship, /reply, /handoff, /fixafs, and /setupafs.",
  "Prefer the plain AFS CLI: start, search, files, notes, handoff, messages, projects, jobs, missions, check, and repair.",
  "Use the scoped discovery ladder: start -> search -> exact files/notes -> named handoff, messages, jobs, missions, check, or repair flow.",
  "The default AFS MCP catalog is intentionally slim: context status/query/search/read/write/list, skill match/read, scoped messages send/read, note create/read/list, and handoff create/read/list.",
  "When the task shifts or needs unfamiliar workflow knowledge, call afs_local_skill_match with the task description and read the matched skill before proceeding.",
  "Do not assume context.diff, context.freshness, task.*, handoff revision/lifecycle, message subscription/cleanup, memory.*, work.*, repair, or session.pack MCP tools are exposed in normal hcode sessions.",
  "The /afs-* commands remain convenient wrappers, but their public vocabulary should map to the plain AFS CLI rather than exposing internal storage terms.",
  "Durable missions, approval requests, structured-response schemas, and the optimization decision gate are CLI-backed flows via /afs-missions, /afs-approvals, /afs-schema, and /afs-optimize; never resolve approvals or promote optimization candidates without explicit user direction.",
  "Prefer visible AFS role agents sparingly: @afs-context for context lookup, @afs-planner for plans, @afs-reviewer for findings, @afs-worker for execution, and @critic for a strict second pass.",
  "Specialized exact-name agents exist for advanced flows, but normal agents should prefer slash commands over browsing a larger AFS catalog.",
  "Worker-style agents may read or write files in the current AFS-resolved project scope, but should keep default writes in scratchpad and use named CLI flows for durable state.",
  "Do not call afs_local_session_pack by default. Reserve it for explicit handoff or export requests, or when the user directly asks for a session pack.",
  "If AFS reports a built-but-stale index, treat that as a freshness advisory for search-heavy work, not as a hard failure.",
  "If an AFS tool is slow or times out, report that plainly and fall back to lighter-weight AFS context instead of retrying aggressively.",
]

export const AFSContextPlugin: Plugin = async ({ directory }) => {
  // AFS resolves the most-specific registered project for the launch path.
  // Using the git worktree here would collapse nested monorepo projects into
  // their broader repository scope and disagree with sidebar polling.
  const base = directory
  const bin = process.env.AFS_BIN?.trim() || process.env.AFS_CLI?.trim() || "afs"

  // Resolve the authoritative context through AFS itself. Invalid v2 projects
  // stay invisible; CLI-resolved v1 contexts remain compatible for one cycle.
  let found: { value: Project | null; retry: number } | undefined
  let finding: Promise<Project | null> | undefined
  const locate = async () => {
    if (found && (found.value || found.retry > Date.now())) return found.value
    if (finding) return finding
    finding = run([bin, "projects", "current", "--path", base, "--json"], {
      timeout: TIMEOUT_MS,
      limit: OUTPUT_LIMIT,
    })
      .then((text) => {
        if (!text) return null
        try {
          return project(JSON.parse(text) as unknown) ?? null
        } catch {
          return null
        }
      })
      .catch(() => null)
      .then((value) => {
        found = { value, retry: value ? 0 : Date.now() + RETRY_MS }
        finding = undefined
        return value
      })
    return finding
  }

  // Keep successful grounding per session. Failures get a short backoff rather
  // than becoming permanent.
  const grounding = new Map<string, { text: string; retry: number }>()
  const pending = new Map<string, Promise<string | null>>()
  const loadGrounding = async (): Promise<string | null> => {
    if (!(await locate())) return null
    return run([bin, "claude", "hook", "--raw", "--event", "SessionStart", "--path", base], {
      timeout: TIMEOUT_MS,
      limit: OUTPUT_LIMIT,
    })
  }
  const staleNote =
    "\n\nRepo note: in this workspace, a built-but-stale index is usually a freshness advisory, not a hard failure. If indexed sources are healthy and the index exists, prefer normal cheap AFS reads and refresh only before search-heavy work."
  const refreshNote =
    "\n\nRepo note: this rebuild targeted the AFS-resolved context index for the current project scope. A later status may still report stale if indexed sources drift again; treat that as advisory unless sources are unhealthy or the index is missing."
  const packNote =
    "\n\nRepo note: repeated session-pack calls may reuse the stored pack artifact when the bootstrap snapshot and pack inputs have not changed."
  return {
    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = typeof input?.sessionID === "string" ? input.sessionID.trim() : ""
      if (!sessionID) return
      const current = await locate()
      if (!current) return
      const note =
        current.version === 2
          ? "For afs_local_context_read/list/write/move/delete, use category-relative paths so AFS can enforce the current project scope. The plugin converts old .context/... spellings without making them absolute."
          : `For afs_local_context_read/list/write/move/delete, prefer absolute paths under the CLI-resolved v1 root ${current.root}.`
      output.system.push([...SYSTEM_GUIDANCE, note].join("\n"))
      // Push live AFS grounding so context reaches the model without an explicit
      // prompt (pull -> push). Appended, never prepended: llm.ts re-collapses
      // system[1..] and preserves system[0], so the prompt-cache header is intact.
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
      if (!TOOLS.has(input.tool) && !FILES.has(input.tool)) return
      const current = await locate()
      if (!current) {
        throw new Error(
          "AFS project scope is unavailable; run `afs projects current --path . --json` and register or repair the project before retrying.",
        )
      }
      const args = output.args as Record<string, unknown>
      args.project_path = base
      args.context_path = current.root
      if (FILES.has(input.tool)) {
        args.path = path(current, args.path)
        args.source = path(current, args.source)
        args.destination = path(current, args.destination)
      }
      if (input.tool === "afs_local_handoff_create") {
        const name = typeof args.agent_name === "string" ? args.agent_name.trim() : ""
        if (!name) args.agent_name = "hcode"
      }
    },
    "tool.execute.after": async (input, output) => {
      if (
        input.tool !== "afs_local_context_status" &&
        input.tool !== "afs_local_context_index_rebuild" &&
        input.tool !== "afs_local_session_pack"
      )
        return
      if (!(await locate())) return
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
