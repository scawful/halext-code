import {
  DEFAULT_BRIDGE_URL,
  createHalextBridgeClient,
  type AfsBootstrapSummary,
  type AfsContextPack,
  type FsEntry,
  type AfsHandoffPacket,
  type AfsStatusSummary,
  type AfsTask,
} from "@halext/bridge"
import {
  createOpencodeClient,
  type Event as OpencodeEvent,
  type GlobalEvent,
  type GlobalSession,
  type Message,
  type McpStatus,
  type Part,
  type Project,
  type SessionStatus as OpencodeSessionStatus,
} from "@opencode-ai/sdk/v2/client"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"

type SessionMessageInfo = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: {
    created: number
    completed?: number
  }
  error?: unknown
}

type SessionMessage = {
  info: SessionMessageInfo
  parts: Part[]
}

type McpEntry = {
  name: string
  status: McpStatus
}

type PendingPrompt = {
  id: string
  sessionID: string
  text: string
  created: number
}

type SessionActivity = {
  mode: "queued" | "busy" | "retry" | "streaming" | "error"
  detail: string
  updatedAt: number
  retryAt?: number
}

type WorkbenchAppProps = {
  initialServerUrl: string
  onServerUrlChange?: (url: string) => void
}

const DEFAULT_DIRECTORY_KEY = "halext.workbench.directory"
const DEFAULT_BRIDGE_URL_KEY = "halext.workbench.bridge_url"
const LIVE_WORKSPACE_REFRESH_MS = 350
const LIVE_MESSAGE_REFRESH_MS = 200
const LIVE_AFS_REFRESH_MS = 1500
const LIVE_RECONNECT_MS = 500

function readStoredValue(key: string, fallback = "") {
  if (typeof localStorage === "undefined") return fallback
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeStoredValue(key: string, value: string) {
  if (typeof localStorage === "undefined") return
  try {
    if (value) {
      localStorage.setItem(key, value)
      return
    }
    localStorage.removeItem(key)
  } catch {
    return
  }
}

function formatDate(timestamp?: number | string) {
  if (!timestamp) return "No timestamp"
  const value = typeof timestamp === "number" ? timestamp : Date.parse(timestamp)
  if (Number.isNaN(value)) return String(timestamp)
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function shortenPath(path?: string) {
  if (!path) return "No path"
  const segments = path.split("/").filter(Boolean)
  return `/${segments.slice(-4).join("/")}`
}

function truncate(text: string, max = 180) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1)}…`
}

function explainError(error: unknown) {
  if (!error) return "Unknown server error"
  if (typeof error === "string") return error
  if (typeof error === "object" && error) {
    if ("message" in error && typeof error.message === "string") return error.message
    if ("detail" in error && typeof error.detail === "string") return error.detail
  }
  return JSON.stringify(error)
}

function formatDuration(start?: number, end?: number) {
  if (!start || !end || end <= start) return ""
  const seconds = (end - start) / 1000
  return seconds >= 10 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`
}

function formatBytes(value?: number) {
  if (!value || value <= 0) return ""
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const AFS_MOUNTS = ["scratchpad", "items", "hivemind", "history", "memory", "global", "knowledge", "tools"] as const

function mountOrder(name: string) {
  const i = AFS_MOUNTS.indexOf(name as (typeof AFS_MOUNTS)[number])
  return i === -1 ? 99 : i
}

function sortAfsEntries(entries: FsEntry[]) {
  return [...entries].toSorted((a, b) => {
    const ai = mountOrder(a.name)
    const bi = mountOrder(b.name)
    if (ai !== bi) return ai - bi
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function focusAfsTree(entries: FsEntry[]) {
  const context = entries.find((entry) => entry.type === "dir" && entry.name === ".context")
  if (context) {
    return [
      {
        ...context,
        children: sortAfsEntries(context.children ?? []),
      },
    ]
  }
  return sortAfsEntries(entries)
}

function previewStructuredValue(value: unknown, max = 420) {
  if (value === undefined || value === null) return ""
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2)
    return truncate(raw, max)
  } catch {
    return truncate(String(value), max)
  }
}

function partTagList(items: Array<string | undefined>) {
  const tags = items.filter((item): item is string => Boolean(item && item.trim()))
  if (tags.length === 0) return null
  return (
    <div class="wb-part-meta">
      {tags.map((tag) => (
        <span class="wb-part-tag">{tag}</span>
      ))}
    </div>
  )
}

function toolStateTone(part: Extract<Part, { type: "tool" }>) {
  if (part.state.status === "error") return "error"
  if (part.state.status === "completed") return "good"
  return "warning"
}

function toolStatusLabel(part: Extract<Part, { type: "tool" }>) {
  if (part.state.status === "completed") return "Completed"
  if (part.state.status === "running") return "Running"
  if (part.state.status === "error") return "Error"
  return "Pending"
}

function toolSummary(part: Extract<Part, { type: "tool" }>) {
  if (part.state.status === "completed") return part.state.title || "Tool completed"
  if (part.state.status === "running") return part.state.title || "Tool running"
  if (part.state.status === "error") return part.state.error || "Tool failed"
  return "Awaiting execution"
}

function partHasVisibleContent(part: Part) {
  if (part.type === "text" || part.type === "reasoning") return part.text.trim().length > 0
  return true
}

function renderMessagePart(part: Part): JSX.Element | null {
  switch (part.type) {
    case "text": {
      const text = part.text.trim()
      if (!text) return null
      return (
        <section class="wb-part is-text">
          <p>{text}</p>
          <Show when={part.synthetic || part.ignored}>
            {partTagList([
              part.synthetic ? "Synthetic" : undefined,
              part.ignored ? "Ignored" : undefined,
              formatDuration(part.time?.start, part.time?.end),
            ])}
          </Show>
        </section>
      )
    }
    case "reasoning": {
      const text = part.text.trim()
      if (!text) return null
      return (
        <section class="wb-part is-reasoning">
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Reasoning</span>
              <strong class="wb-part-title">Model thinking trace</strong>
            </div>
            <span class="wb-pill">{formatDuration(part.time.start, part.time.end) || "Live"}</span>
          </div>
          <p>{text}</p>
        </section>
      )
    }
    case "tool": {
      const inputPreview = previewStructuredValue(part.state.input, 280)
      const outputPreview = part.state.status === "completed" ? previewStructuredValue(part.state.output, 420) : ""
      const errorPreview = part.state.status === "error" ? previewStructuredValue(part.state.error, 420) : ""
      const toneClass = sessionActivityClass(toolStateTone(part))
      const duration =
        part.state.status === "completed" || part.state.status === "error"
          ? formatDuration(part.state.time.start, part.state.time.end)
          : ""
      return (
        <section class={`wb-part is-tool ${toneClass}`}>
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Tool</span>
              <strong class="wb-part-title">{part.tool}</strong>
            </div>
            <span class={`wb-pill ${toneClass}`}>{toolStatusLabel(part)}</span>
          </div>
          <p class="wb-part-summary">{toolSummary(part)}</p>
          {partTagList([
            duration,
            part.state.status === "running" ? `Started ${formatDate(part.state.time.start)}` : undefined,
            part.state.status === "completed" && part.state.attachments?.length
              ? `${part.state.attachments.length} attachment${part.state.attachments.length === 1 ? "" : "s"}`
              : undefined,
          ])}
          <Show when={inputPreview}>
            <div class="wb-part-section">
              <span class="wb-part-section-label">Input</span>
              <pre class="wb-part-pre">{inputPreview}</pre>
            </div>
          </Show>
          <Show when={outputPreview}>
            <div class="wb-part-section">
              <span class="wb-part-section-label">Output</span>
              <pre class="wb-part-pre">{outputPreview}</pre>
            </div>
          </Show>
          <Show when={errorPreview}>
            <div class="wb-part-section">
              <span class="wb-part-section-label">Error</span>
              <pre class="wb-part-pre">{errorPreview}</pre>
            </div>
          </Show>
        </section>
      )
    }
    case "patch": {
      const visibleFiles = part.files.slice(0, 6)
      return (
        <section class="wb-part is-patch">
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Patch</span>
              <strong class="wb-part-title">Applied code changes</strong>
            </div>
            <span class="wb-pill is-good">
              {part.files.length} file{part.files.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul class="wb-part-list">
            {visibleFiles.map((file) => (
              <li>{shortenPath(file)}</li>
            ))}
          </ul>
          <Show when={part.files.length > visibleFiles.length}>
            <small class="wb-message-note">+{part.files.length - visibleFiles.length} more files</small>
          </Show>
        </section>
      )
    }
    case "agent":
      return (
        <section class="wb-part is-agent">
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Agent</span>
              <strong class="wb-part-title">@{part.name}</strong>
            </div>
          </div>
          <Show when={part.source?.value}>
            <p>{truncate(part.source?.value ?? "", 280)}</p>
          </Show>
        </section>
      )
    case "subtask":
      return (
        <section class="wb-part is-subtask">
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Subtask</span>
              <strong class="wb-part-title">{part.description}</strong>
            </div>
            <span class="wb-pill">@{part.agent}</span>
          </div>
          <Show when={part.prompt.trim()}>
            <p>{truncate(part.prompt, 360)}</p>
          </Show>
          {partTagList([
            part.command ? truncate(part.command, 80) : undefined,
            part.model ? `${part.model.providerID}/${part.model.modelID}` : undefined,
          ])}
        </section>
      )
    case "file":
      return (
        <section class="wb-part is-meta">
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Attachment</span>
              <strong class="wb-part-title">
                {part.filename ||
                  (part.source?.type === "file" || part.source?.type === "symbol" ? shortenPath(part.source.path) : "") ||
                  part.mime}
              </strong>
            </div>
          </div>
          {partTagList([
            part.mime,
            part.source?.type === "file" || part.source?.type === "symbol" ? shortenPath(part.source.path) : undefined,
            part.source?.type === "resource" ? `${part.source.clientName}:${part.source.uri}` : undefined,
          ])}
        </section>
      )
    case "retry":
      return (
        <section class="wb-part is-meta is-error">
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Retry</span>
              <strong class="wb-part-title">Attempt {part.attempt}</strong>
            </div>
            <span class="wb-pill is-error">Retry</span>
          </div>
          <p>{part.error.data.message}</p>
        </section>
      )
    case "step-start":
      return (
        <section class="wb-part is-meta">
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Step</span>
              <strong class="wb-part-title">Execution step started</strong>
            </div>
          </div>
          <Show when={part.snapshot}>
            <p>{truncate(part.snapshot ?? "", 220)}</p>
          </Show>
        </section>
      )
    case "step-finish": {
      const totalTokens = part.tokens.total ?? part.tokens.input + part.tokens.output + part.tokens.reasoning
      return (
        <section class="wb-part is-meta">
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Step</span>
              <strong class="wb-part-title">Execution step finished</strong>
            </div>
            <span class="wb-pill">{part.reason}</span>
          </div>
          {partTagList([
            `${totalTokens.toLocaleString()} tokens`,
            `$${part.cost.toFixed(4)}`,
            part.snapshot ? "Snapshot captured" : undefined,
          ])}
        </section>
      )
    }
    case "snapshot":
      return (
        <section class="wb-part is-meta">
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Snapshot</span>
              <strong class="wb-part-title">Context snapshot</strong>
            </div>
          </div>
          <p>{truncate(part.snapshot, 320)}</p>
        </section>
      )
    case "compaction":
      return (
        <section class="wb-part is-meta">
          <div class="wb-part-header">
            <div class="wb-part-heading">
              <span class="wb-part-label">Compaction</span>
              <strong class="wb-part-title">{part.auto ? "Automatic context compaction" : "Manual context compaction"}</strong>
            </div>
            <Show when={part.overflow}>
              <span class="wb-pill is-warning">Overflow</span>
            </Show>
          </div>
        </section>
      )
  }

  return null
}

function renderMessageParts(parts: Part[]) {
  const visibleParts = parts.filter(partHasVisibleContent)
  if (visibleParts.length === 0) return <p class="wb-message-note">Structured response</p>
  return visibleParts.map((part) => renderMessagePart(part))
}

function summarizeMcpStatus(status: McpStatus) {
  switch (status.status) {
    case "connected":
      return "Connected"
    case "disabled":
      return "Disabled"
    case "failed":
      return status.error
    case "needs_auth":
      return "Needs auth"
    case "needs_client_registration":
      return status.error
  }
}

function summarizeIndex(status?: AfsStatusSummary) {
  const index = status?.index
  if (!index) return "Index unknown"
  const entryCount = typeof index.total_entries === "number" ? `${index.total_entries.toLocaleString()} entries` : "entry count unknown"
  if (index.stale) return `Index stale, ${entryCount}`
  if (index.has_entries || index.available || index.enabled) return `Index ready, ${entryCount}`
  return "Index unavailable"
}

function summarizePhase(summary?: AfsBootstrapSummary | null) {
  const stateText = summary?.scratchpad?.state_text
  if (!stateText) return ""
  const line = stateText
    .split("\n")
    .find((entry) => entry.trim().toLowerCase().startsWith("- phase:"))
  return line ? line.split(":").slice(1).join(":").trim() : ""
}

function summarizePackBody(pack: AfsContextPack) {
  return pack.sections.slice(0, 3)
}

function summarizeTaskCounts(tasks?: AfsBootstrapSummary["tasks"]) {
  if (!tasks) return []
  return Object.entries(tasks.counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${count} ${status}`)
}

function pickTaskPreview(tasks: AfsTask[]) {
  return tasks.filter((task) => task.status !== "done" && task.status !== "completed").slice(0, 4)
}

function summarizeHandoffItems(handoff: AfsHandoffPacket) {
  const items = handoff.next_steps.length > 0 ? handoff.next_steps : handoff.accomplished
  return items.slice(0, 3)
}

function toSessionMessageInfo(message: Message): SessionMessageInfo {
  return {
    id: message.id,
    sessionID: message.sessionID,
    role: message.role,
    time: message.time,
    error: message.role === "assistant" ? message.error : undefined,
  }
}

function sortSessionMessages(items: SessionMessage[]) {
  return [...items].sort((left, right) => left.info.time.created - right.info.time.created)
}

function sortSessionsByUpdated(items: GlobalSession[]) {
  return [...items].sort((left, right) => right.time.updated - left.time.updated)
}

function upsertSessionRecord(items: GlobalSession[], next: GlobalSession) {
  const index = items.findIndex((item) => item.id === next.id)
  if (index === -1) return sortSessionsByUpdated([next, ...items])
  const merged = {
    ...items[index],
    ...next,
    project: next.project ?? items[index].project,
  }
  const updated = [...items]
  updated[index] = merged
  return sortSessionsByUpdated(updated)
}

function removeSessionRecord(items: GlobalSession[], sessionID: string) {
  return items.filter((item) => item.id !== sessionID)
}

function touchSessionRecord(items: GlobalSession[], sessionID: string, updatedAt = Date.now()) {
  return sortSessionsByUpdated(
    items.map((item) =>
      item.id === sessionID
        ? {
            ...item,
            time: {
              ...item.time,
              updated: updatedAt,
            },
          }
        : item,
    ),
  )
}

function makeAssistantShellMessage(sessionID: string, messageID: string): SessionMessage {
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      time: {
        created: Date.now(),
      },
    },
    parts: [],
  }
}

function upsertSessionMessage(items: SessionMessage[], info: SessionMessageInfo) {
  const index = items.findIndex((item) => item.info.id === info.id)
  if (index === -1) return sortSessionMessages([...items, { info, parts: [] }])
  const updated = [...items]
  updated[index] = {
    ...updated[index],
    info: {
      ...updated[index].info,
      ...info,
    },
  }
  return sortSessionMessages(updated)
}

function removeSessionMessage(items: SessionMessage[], messageID: string) {
  return items.filter((item) => item.info.id !== messageID)
}

function upsertSessionMessagePart(items: SessionMessage[], part: Part) {
  const messageIndex = items.findIndex((item) => item.info.id === part.messageID)
  if (messageIndex === -1) {
    return sortSessionMessages([
      ...items,
      {
        ...makeAssistantShellMessage(part.sessionID, part.messageID),
        parts: [part],
      },
    ])
  }

  const nextParts = [...items[messageIndex].parts]
  const partIndex = nextParts.findIndex((item) => item.id === part.id)

  if (partIndex === -1) {
    nextParts.push(part)
  } else {
    nextParts[partIndex] = part
  }

  const updated = [...items]
  updated[messageIndex] = {
    ...updated[messageIndex],
    parts: nextParts,
  }
  return sortSessionMessages(updated)
}

function removeSessionMessagePart(items: SessionMessage[], messageID: string, partID: string) {
  return items.map((item) =>
    item.info.id === messageID
      ? {
          ...item,
          parts: item.parts.filter((part) => part.id !== partID),
        }
      : item,
  )
}

function applySessionMessagePartDelta(
  items: SessionMessage[],
  input: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
  },
) {
  let applied = false
  const next = items.some((message) => message.info.id === input.messageID)
    ? items
    : sortSessionMessages([...items, makeAssistantShellMessage(input.sessionID, input.messageID)])
  const patched = next.map((message) => {
    if (message.info.id !== input.messageID) return message
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (part.id !== input.partID) return part
        if (input.field === "text" && (part.type === "text" || part.type === "reasoning")) {
          applied = true
          return {
            ...part,
            text: `${part.text}${input.delta}`,
          }
        }
        if (input.field === "state.title" && part.type === "tool" && "title" in part.state) {
          applied = true
          return {
            ...part,
            state: {
              ...part.state,
              title: `${part.state.title ?? ""}${input.delta}`,
            },
          }
        }
        return part
      }),
    }
  })
  return {
    applied,
    messages: patched,
  }
}

function promptText(parts: Part[]) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function reconcilePendingPrompts(items: PendingPrompt[], sessionID: string, messages: SessionMessage[]) {
  const acknowledged = new Map<string, number>()

  for (const message of messages) {
    if (message.info.sessionID !== sessionID || message.info.role !== "user") continue
    const text = promptText(message.parts)
    if (!text) continue
    acknowledged.set(text, (acknowledged.get(text) ?? 0) + 1)
  }

  return items.filter((item) => {
    if (item.sessionID !== sessionID) return true
    const count = acknowledged.get(item.text) ?? 0
    if (count <= 0) return true
    acknowledged.set(item.text, count - 1)
    return false
  })
}

function summarizeSessionActivity(state?: SessionActivity, pendingCount = 0) {
  if (!state && pendingCount <= 0) return "Idle"
  if (state?.mode === "retry") {
    return state.retryAt ? `Retrying soon (${Math.max(1, Math.ceil((state.retryAt - Date.now()) / 1000))}s)` : "Retrying"
  }
  if (state?.mode === "streaming") return "Streaming response"
  if (state?.mode === "busy") return pendingCount > 0 ? `Running with ${pendingCount} queued` : "Running"
  if (state?.mode === "error") return "Session error"
  if (pendingCount > 1) return `${pendingCount} queued`
  if (pendingCount === 1) return "Prompt queued"
  return state?.detail || "Working"
}

function sessionActivityTone(state?: SessionActivity, pendingCount = 0) {
  if (state?.mode === "error") return "error"
  if (state?.mode === "retry") return "warning"
  if (state || pendingCount > 0) return "good"
  return "neutral"
}

function sessionActivityClass(tone: ReturnType<typeof sessionActivityTone>) {
  if (tone === "error") return "is-error"
  if (tone === "warning") return "is-warning"
  if (tone === "good") return "is-good"
  return ""
}

function eventSessionID(event: OpencodeEvent) {
  switch (event.type) {
    case "message.updated":
      return event.properties.info.sessionID
    case "message.removed":
    case "message.part.delta":
    case "message.part.removed":
    case "session.status":
    case "session.idle":
    case "session.compacted":
    case "session.diff":
    case "session.error":
    case "todo.updated":
    case "command.executed":
      return event.properties.sessionID
    case "message.part.updated":
      return event.properties.part.sessionID
    case "session.created":
    case "session.updated":
    case "session.deleted":
      return event.properties.info.id
    default:
      return undefined
  }
}

function shouldRefreshAfsForEvent(event: OpencodeEvent) {
  switch (event.type) {
    case "server.connected":
    case "global.disposed":
    case "session.created":
    case "session.updated":
    case "session.deleted":
    case "session.compacted":
    case "session.error":
    case "todo.updated":
    case "permission.asked":
    case "permission.replied":
    case "question.asked":
    case "question.replied":
    case "question.rejected":
    case "command.executed":
    case "mcp.tools.changed":
      return true
    default:
      return false
  }
}

function summarizeLiveSync(state: "idle" | "connecting" | "live" | "reconnecting" | "error", detail: string) {
  switch (state) {
    case "idle":
      return detail || "Live sync idle"
    case "connecting":
      return detail || "Live sync connecting"
    case "live":
      return detail || "Live sync live"
    case "reconnecting":
      return detail || "Live sync reconnecting"
    case "error":
      return detail || "Live sync error"
  }
}

function describeLiveEvent(event: OpencodeEvent) {
  switch (event.type) {
    case "session.status":
      return `Live sync ${event.properties.status.type}`
    case "session.idle":
      return "Live sync session idle"
    case "session.compacted":
      return "Live sync compaction finished"
    case "message.updated":
      return "Live sync message updated"
    case "message.part.delta":
      return "Live sync streaming response"
    case "todo.updated":
      return `Live sync todos ${event.properties.todos.length}`
    case "mcp.tools.changed":
      return `Live sync MCP ${event.properties.server}`
    default:
      return `Live sync ${event.type}`
  }
}

export function WorkbenchApp(props: WorkbenchAppProps) {
  const [draftServerUrl, setDraftServerUrl] = createSignal(props.initialServerUrl)
  const [draftBridgeUrl, setDraftBridgeUrl] = createSignal(readStoredValue(DEFAULT_BRIDGE_URL_KEY, DEFAULT_BRIDGE_URL))
  const [draftDirectory, setDraftDirectory] = createSignal(readStoredValue(DEFAULT_DIRECTORY_KEY))
  const [appliedServerUrl, setAppliedServerUrl] = createSignal(props.initialServerUrl)
  const [appliedBridgeUrl, setAppliedBridgeUrl] = createSignal(readStoredValue(DEFAULT_BRIDGE_URL_KEY, DEFAULT_BRIDGE_URL))
  const [appliedDirectory, setAppliedDirectory] = createSignal(readStoredValue(DEFAULT_DIRECTORY_KEY))

  const [projects, setProjects] = createSignal<Project[]>([])
  const [sessions, setSessions] = createSignal<GlobalSession[]>([])
  const [messages, setMessages] = createSignal<SessionMessage[]>([])
  const [mcpEntries, setMcpEntries] = createSignal<McpEntry[]>([])
  const [afsSummary, setAfsSummary] = createSignal<AfsBootstrapSummary | null>(null)
  const [afsPack, setAfsPack] = createSignal<AfsContextPack | null>(null)
  const [afsPackPath, setAfsPackPath] = createSignal("")
  const [fsRoot, setFsRoot] = createSignal("")
  const [fsTarget, setFsTarget] = createSignal("")
  const [fsEntries, setFsEntries] = createSignal<FsEntry[]>([])
  const [fsScope, setFsScope] = createSignal<"afs" | "all">("afs")
  const [fsSelectedPath, setFsSelectedPath] = createSignal("")
  const [fsPreview, setFsPreview] = createSignal("")
  const [fsPreviewMeta, setFsPreviewMeta] = createSignal("")
  const [pendingPrompts, setPendingPrompts] = createSignal<PendingPrompt[]>([])
  const [sessionActivities, setSessionActivities] = createSignal<Record<string, SessionActivity>>({})

  const [selectedSessionID, setSelectedSessionID] = createSignal<string>("")
  const [draftPrompt, setDraftPrompt] = createSignal("")
  const [packQuery, setPackQuery] = createSignal("workbench afs bridge")
  const [statusText, setStatusText] = createSignal("Point the workbench at an opencode server and load a project.")
  const [errorText, setErrorText] = createSignal("")
  const [afsErrorText, setAfsErrorText] = createSignal("")
  const [afsPackErrorText, setAfsPackErrorText] = createSignal("")
  const [fsErrorText, setFsErrorText] = createSignal("")
  const [loadingWorkspace, setLoadingWorkspace] = createSignal(false)
  const [loadingMessages, setLoadingMessages] = createSignal(false)
  const [loadingAfsSummary, setLoadingAfsSummary] = createSignal(false)
  const [loadingAfsPack, setLoadingAfsPack] = createSignal(false)
  const [loadingFs, setLoadingFs] = createSignal(false)
  const [loadingFsPreview, setLoadingFsPreview] = createSignal(false)
  const [sendingPrompt, setSendingPrompt] = createSignal(false)
  const [liveSyncState, setLiveSyncState] = createSignal<"idle" | "connecting" | "live" | "reconnecting" | "error">("idle")
  const [liveSyncDetail, setLiveSyncDetail] = createSignal("Live sync idle")

  const client = createMemo(() =>
    createOpencodeClient({
      baseUrl: appliedServerUrl(),
      directory: appliedDirectory().trim() || undefined,
    }),
  )

  const bridgeClient = createMemo(() => {
    const baseUrl = appliedBridgeUrl().trim()
    return baseUrl ? createHalextBridgeClient({ baseUrl }) : null
  })

  const selectedSession = createMemo(() => sessions().find((session) => session.id === selectedSessionID()))
  const connectedAfs = createMemo(() => mcpEntries().find((entry) => entry.name === "afs_local"))
  const activeAfsPath = createMemo(
    () => appliedDirectory().trim() || selectedSession()?.directory || sessions()[0]?.directory || projects()[0]?.worktree || "",
  )
  const latestHandoff = createMemo(() => {
    const handoff = afsSummary()?.handoff
    return handoff && handoff.available ? handoff : null
  })
  const selectedSessionActivity = createMemo(() => sessionActivities()[selectedSessionID()])
  const selectedPendingPrompts = createMemo(() => pendingPrompts().filter((item) => item.sessionID === selectedSessionID()))
  const selectedActivityLabel = createMemo(() => summarizeSessionActivity(selectedSessionActivity(), selectedPendingPrompts().length))
  const selectedActivityTone = createMemo(() => sessionActivityTone(selectedSessionActivity(), selectedPendingPrompts().length))
  const selectedActivityUpdatedAt = createMemo(
    () => selectedSessionActivity()?.updatedAt ?? selectedPendingPrompts()[selectedPendingPrompts().length - 1]?.created,
  )
  const taskPreview = createMemo(() => pickTaskPreview(afsSummary()?.tasks.items ?? []))
  const recommendationPreview = createMemo(() => (afsSummary()?.recommended_actions ?? []).slice(0, 4))
  const composerStatusText = createMemo(() =>
    selectedSession()
      ? selectedActivityLabel() !== "Idle"
        ? selectedActivityLabel()
        : statusText()
      : statusText(),
  )
  const bridgeStatusText = createMemo(() => {
    if (!appliedBridgeUrl().trim()) return "Bridge disabled"
    if (loadingAfsSummary()) return "Bridge loading"
    if (afsSummary()) return "Bridge live"
    if (afsErrorText()) return "Bridge error"
    return "Bridge idle"
  })
  const fsVisibleEntries = createMemo(() => (fsScope() === "afs" ? focusAfsTree(fsEntries()) : fsEntries()))
  const fsMounts = createMemo(() => {
    const root = fsEntries().find((entry) => entry.type === "dir" && entry.name === ".context")
    const list = root?.children ?? fsEntries()
    return sortAfsEntries(list)
      .filter((entry) => entry.type === "dir" && mountOrder(entry.name) < 99)
      .map((entry) => entry.name)
  })

  createEffect(() => {
    writeStoredValue(DEFAULT_DIRECTORY_KEY, draftDirectory())
  })

  createEffect(() => {
    writeStoredValue(DEFAULT_BRIDGE_URL_KEY, draftBridgeUrl())
  })

  function setSessionActivity(sessionID: string, next?: SessionActivity) {
    setSessionActivities((current) => {
      if (!next) {
        if (!(sessionID in current)) return current
        const updated = { ...current }
        delete updated[sessionID]
        return updated
      }
      return {
        ...current,
        [sessionID]: next,
      }
    })
  }

  function clearSessionActivity(sessionID: string) {
    setSessionActivity(sessionID, undefined)
  }

  function syncMessages(sessionID: string, nextMessages: SessionMessage[]) {
    setMessages(sortSessionMessages(nextMessages))
    setPendingPrompts((current) => reconcilePendingPrompts(current, sessionID, nextMessages))
  }

  function updateMessagesLocally(sessionID: string, updater: (items: SessionMessage[]) => SessionMessage[]) {
    const next = sortSessionMessages(updater(messages()))
    syncMessages(sessionID, next)
  }

  function queueOptimisticPrompt(sessionID: string, text: string) {
    const prompt = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      sessionID,
      text,
      created: Date.now(),
    }
    setPendingPrompts((current) => [...current, prompt])
    return prompt
  }

  function updateSessionActivityFromStatus(sessionID: string, status: OpencodeSessionStatus) {
    const updatedAt = Date.now()
    if (status.type === "idle") {
      clearSessionActivity(sessionID)
      return
    }
    if (status.type === "retry") {
      setSessionActivity(sessionID, {
        mode: "retry",
        detail: status.message,
        updatedAt,
        retryAt: status.next,
      })
      return
    }
    setSessionActivity(sessionID, {
      mode: "busy",
      detail: "Running",
      updatedAt,
    })
  }

  async function refreshAfsSummary(projectPath = activeAfsPath()) {
    const nextBridge = bridgeClient()
    if (!nextBridge) {
      setAfsSummary(null)
      setAfsErrorText("")
      return
    }
    if (!projectPath) {
      setAfsSummary(null)
      setAfsErrorText("Pick a project or directory before loading AFS context.")
      return
    }

    if (afsPackPath() && afsPackPath() !== projectPath) {
      setAfsPack(null)
      setAfsPackPath("")
      setAfsPackErrorText("")
    }

    setLoadingAfsSummary(true)
    setAfsErrorText("")

    try {
      const summary = await nextBridge.getSummary({
        path: projectPath,
        taskLimit: 12,
        messageLimit: 3,
      })
      setAfsSummary(summary)
    } catch (error) {
      setAfsSummary(null)
      setAfsErrorText(explainError(error))
    } finally {
      setLoadingAfsSummary(false)
    }
  }

  async function refreshWorkspace(options?: { includeAfsSummary?: boolean }) {
    setLoadingWorkspace(true)
    setErrorText("")

    const nextClient = client()
    const directory = appliedDirectory().trim() || undefined

    const [projectResult, sessionResult, mcpResult] = await Promise.all([
      nextClient.project.list(undefined, { throwOnError: false }),
      nextClient.experimental.session.list(
        {
          directory,
          limit: 24,
          roots: true,
        },
        { throwOnError: false },
      ),
      nextClient.mcp.status(directory ? { directory } : undefined, { throwOnError: false }),
    ])

    if (projectResult.error || sessionResult.error || mcpResult.error) {
      setErrorText(
        explainError(projectResult.error) ||
          explainError(sessionResult.error) ||
          explainError(mcpResult.error),
      )
      setLoadingWorkspace(false)
      return
    }

    const nextProjects = projectResult.data ?? []
    const nextSessions = sessionResult.data ?? []
    const nextMcpEntries = Object.entries(mcpResult.data ?? {}).map(([name, status]) => ({ name, status }))

    setProjects(nextProjects)
    setSessions(nextSessions)
    setMcpEntries(nextMcpEntries)

    const activeSession = nextSessions.find((session) => session.id === selectedSessionID())
    const fallbackSession = activeSession ?? nextSessions[0]
    setSelectedSessionID(fallbackSession?.id ?? "")

    const bridgePath = directory ?? fallbackSession?.directory ?? nextProjects[0]?.worktree ?? ""
    if (options?.includeAfsSummary !== false) {
      await refreshAfsSummary(bridgePath)
    }
    await refreshFs(bridgePath)

    setStatusText(
      `Loaded ${nextProjects.length} project${nextProjects.length === 1 ? "" : "s"}, ${nextSessions.length} recent session${nextSessions.length === 1 ? "" : "s"}, and ${nextMcpEntries.length} MCP server${nextMcpEntries.length === 1 ? "" : "s"}.`,
    )

    setLoadingWorkspace(false)
  }

  async function refreshMessages(session = selectedSession()) {
    if (!session) {
      setMessages([])
      return
    }

    setLoadingMessages(true)
    setErrorText("")

    const result = await client().session.messages(
      {
        sessionID: session.id,
        directory: session.directory,
        limit: 60,
      },
      { throwOnError: false },
    )

    if (result.error) {
      setErrorText(explainError(result.error))
      setLoadingMessages(false)
      return
    }

    syncMessages(
      session.id,
      ((result.data ?? []) as Array<{ info: Message; parts: Part[] }>).map((item) => ({
        info: toSessionMessageInfo(item.info),
        parts: item.parts,
      })),
    )
    setLoadingMessages(false)
  }

  async function buildPackPreview() {
    const nextBridge = bridgeClient()
    const projectPath = activeAfsPath()

    if (!nextBridge) {
      setAfsPackErrorText("Set a bridge URL before building a session pack preview.")
      return
    }
    if (!projectPath) {
      setAfsPackErrorText("Pick a project or directory before building a session pack preview.")
      return
    }

    setLoadingAfsPack(true)
    setAfsPackErrorText("")

    try {
      const pack = await nextBridge.getPack({
        path: projectPath,
        query: packQuery().trim() || undefined,
        model: "codex",
        maxQueryResults: 4,
        maxEmbeddingResults: 0,
        timeoutMs: 60000,
      })
      setAfsPack(pack)
      setAfsPackPath(projectPath)
    } catch (error) {
      setAfsPack(null)
      setAfsPackErrorText(explainError(error))
    } finally {
      setLoadingAfsPack(false)
    }
  }

  async function refreshFs(target?: string) {
    const nextBridge = bridgeClient()
    const root = activeAfsPath()
    const path = target?.trim() || fsTarget() || root
    if (!nextBridge) {
      setFsEntries([])
      setFsErrorText("Set a bridge URL before loading the file browser.")
      return
    }
    if (!root) {
      setFsEntries([])
      setFsErrorText("Pick a project or directory before loading files.")
      return
    }
    setLoadingFs(true)
    setFsErrorText("")
    try {
      const result = await nextBridge.getFsList({
        root,
        path,
        depth: 2,
        limit: 220,
      })
      setFsRoot(result.root)
      setFsTarget(result.target)
      setFsEntries(result.entries)
    } catch (error) {
      setFsEntries([])
      setFsErrorText(explainError(error))
    } finally {
      setLoadingFs(false)
    }
  }

  async function previewFs(path: string) {
    const nextBridge = bridgeClient()
    const root = activeAfsPath()
    if (!nextBridge || !root) return
    setLoadingFsPreview(true)
    setFsSelectedPath(path)
    try {
      const result = await nextBridge.getFsRead({
        root,
        path,
        maxBytes: 60000,
      })
      setFsPreview(result.content)
      setFsPreviewMeta(
        `${shortenPath(result.path)} · ${result.mime}${result.truncated ? " · truncated" : ""} · ${formatBytes(result.size)}`,
      )
    } catch (error) {
      setFsPreview("")
      setFsPreviewMeta("")
      setFsErrorText(explainError(error))
    } finally {
      setLoadingFsPreview(false)
    }
  }

  async function applyConnection() {
    const normalizedServer = draftServerUrl().trim()
    const normalizedBridge = draftBridgeUrl().trim()
    const normalizedDirectory = draftDirectory().trim()

    setAppliedServerUrl(normalizedServer)
    setAppliedBridgeUrl(normalizedBridge)
    setAppliedDirectory(normalizedDirectory)
    setAfsPack(null)
    setAfsPackPath("")
    setAfsPackErrorText("")
    setFsPreview("")
    setFsPreviewMeta("")
    setFsSelectedPath("")
    props.onServerUrlChange?.(normalizedServer)
    await refreshWorkspace()
  }

  async function openProject(project: Project) {
    setDraftDirectory(project.worktree)
    setAppliedDirectory(project.worktree)
    setAfsPack(null)
    setAfsPackPath("")
    setFsPreview("")
    setFsPreviewMeta("")
    setFsSelectedPath("")
    await refreshWorkspace()
  }

  async function createSession() {
    const targetDirectory = appliedDirectory().trim() || projects()[0]?.worktree
    if (!targetDirectory) {
      setErrorText("Pick a project or set a directory before creating a session.")
      return
    }

    const result = await client().session.create(
      {
        directory: targetDirectory,
        title: "Halext Workbench",
      },
      { throwOnError: false },
    )

    if (result.error || !result.data) {
      setErrorText(explainError(result.error))
      return
    }

    setDraftDirectory(targetDirectory)
    setAppliedDirectory(targetDirectory)
    setSelectedSessionID(result.data.id)
    await refreshWorkspace()
  }

  async function sendPrompt() {
    const session = selectedSession()
    const text = draftPrompt().trim()

    if (!session || !text) return

    setSendingPrompt(true)
    setErrorText("")

    const result = await client().session.promptAsync(
      {
        sessionID: session.id,
        directory: session.directory,
        parts: [
          {
            type: "text",
            text,
          },
        ],
      },
      { throwOnError: false },
    )

    if (result.error) {
      setErrorText(explainError(result.error))
      setSendingPrompt(false)
      return
    }

    queueOptimisticPrompt(session.id, text)
    setSessions((current) => touchSessionRecord(current, session.id))
    setSessionActivity(session.id, {
      mode: "queued",
      detail: "Prompt queued",
      updatedAt: Date.now(),
    })
    setDraftPrompt("")
    setStatusText("Prompt queued. Live sync will stream session updates into the canvas.")
    setSendingPrompt(false)
  }

  createEffect(() => {
    const session = selectedSession()
    if (!session) {
      setMessages([])
      return
    }
    void refreshMessages(session)
  })

  createEffect(() => {
    const nextClient = client()
    const abort = new AbortController()
    let workspaceTimer: ReturnType<typeof setTimeout> | undefined
    let messageTimer: ReturnType<typeof setTimeout> | undefined
    let afsTimer: ReturnType<typeof setTimeout> | undefined
    let pendingAfsPath = ""

    const clearTimers = () => {
      if (workspaceTimer) clearTimeout(workspaceTimer)
      if (messageTimer) clearTimeout(messageTimer)
      if (afsTimer) clearTimeout(afsTimer)
      workspaceTimer = undefined
      messageTimer = undefined
      afsTimer = undefined
    }

    const scheduleWorkspaceRefresh = () => {
      if (workspaceTimer) return
      workspaceTimer = setTimeout(() => {
        workspaceTimer = undefined
        void refreshWorkspace({ includeAfsSummary: false })
      }, LIVE_WORKSPACE_REFRESH_MS)
    }

    const scheduleMessageRefresh = () => {
      if (messageTimer) return
      messageTimer = setTimeout(() => {
        messageTimer = undefined
        const session = selectedSession()
        if (!session) return
        void refreshMessages(session)
      }, LIVE_MESSAGE_REFRESH_MS)
    }

    const scheduleAfsRefresh = (projectPath?: string) => {
      const target = projectPath?.trim() || activeAfsPath()
      if (!target || !bridgeClient()) return
      pendingAfsPath = target
      if (afsTimer) return
      afsTimer = setTimeout(() => {
        afsTimer = undefined
        if (!pendingAfsPath) return
        void refreshAfsSummary(pendingAfsPath)
      }, LIVE_AFS_REFRESH_MS)
    }

    const handleLiveEvent = (event: GlobalEvent) => {
      const directory = event.directory
      const payload = event.payload
      const selected = selectedSession()
      const activePath = activeAfsPath()
      const matchesActiveDirectory =
        directory === "global" || (!!activePath && directory === activePath) || (!!selected && directory === selected.directory)

      if (!matchesActiveDirectory) return

      setLiveSyncState("live")
      setLiveSyncDetail(describeLiveEvent(payload))

      if (payload.type === "server.connected" || payload.type === "global.disposed" || payload.type === "project.updated") {
        scheduleWorkspaceRefresh()
      }

      if (shouldRefreshAfsForEvent(payload)) {
        scheduleAfsRefresh(directory === "global" ? activePath : directory)
      }

      if (payload.type === "mcp.tools.changed" || payload.type === "permission.asked" || payload.type === "permission.replied") {
        scheduleWorkspaceRefresh()
      }

      if (payload.type === "session.created") {
        setSessions((current) => upsertSessionRecord(current, payload.properties.info as GlobalSession))
        return
      }

      if (payload.type === "session.updated") {
        setSessions((current) => upsertSessionRecord(current, payload.properties.info as GlobalSession))
        return
      }

      if (payload.type === "session.deleted") {
        setSessions((current) => removeSessionRecord(current, payload.properties.info.id))
        clearSessionActivity(payload.properties.info.id)
        return
      }

      const sessionID = eventSessionID(payload)
      if (!sessionID) return

      setSessions((current) => touchSessionRecord(current, sessionID))

      if (payload.type === "session.status") {
        updateSessionActivityFromStatus(sessionID, payload.properties.status)
        return
      }

      if (payload.type === "session.idle") {
        clearSessionActivity(sessionID)
        if (selected && directory === selected.directory && sessionID === selected.id) {
          scheduleMessageRefresh()
        }
        return
      }

      if (payload.type === "session.compacted") {
        setSessionActivity(sessionID, {
          mode: "streaming",
          detail: "Compaction finished",
          updatedAt: Date.now(),
        })
        if (selected && directory === selected.directory && sessionID === selected.id) {
          scheduleMessageRefresh()
        }
        return
      }

      if (payload.type === "session.error") {
        const detail = explainError(payload.properties.error ?? "Session error")
        setSessionActivity(sessionID, {
          mode: "error",
          detail,
          updatedAt: Date.now(),
        })
        if (selected && directory === selected.directory && sessionID === selected.id) {
          scheduleMessageRefresh()
        }
        return
      }

      if (!selected || directory !== selected.directory || sessionID !== selected.id) {
        return
      }

      if (payload.type === "message.updated") {
        updateMessagesLocally(sessionID, (current) => upsertSessionMessage(current, toSessionMessageInfo(payload.properties.info)))
        if (payload.properties.info.role === "user") {
          scheduleMessageRefresh()
        }
        return
      }

      if (payload.type === "message.removed") {
        updateMessagesLocally(sessionID, (current) => removeSessionMessage(current, payload.properties.messageID))
        return
      }

      if (payload.type === "message.part.updated") {
        updateMessagesLocally(sessionID, (current) => upsertSessionMessagePart(current, payload.properties.part))
        return
      }

      if (payload.type === "message.part.removed") {
        updateMessagesLocally(sessionID, (current) =>
          removeSessionMessagePart(current, payload.properties.messageID, payload.properties.partID),
        )
        return
      }

      if (payload.type === "message.part.delta") {
        const next = applySessionMessagePartDelta(messages(), {
          sessionID,
          messageID: payload.properties.messageID,
          partID: payload.properties.partID,
          field: payload.properties.field,
          delta: payload.properties.delta,
        })
        setSessionActivity(sessionID, {
          mode: "streaming",
          detail: "Streaming response",
          updatedAt: Date.now(),
        })
        if (next.applied) {
          syncMessages(sessionID, next.messages)
          return
        }
        scheduleMessageRefresh()
      }
    }

    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

    void (async () => {
      let hasConnected = false

      while (!abort.signal.aborted) {
        setLiveSyncState(hasConnected ? "reconnecting" : "connecting")
        setLiveSyncDetail(hasConnected ? "Live sync reconnecting" : "Live sync connecting")

        try {
          const events = await nextClient.global.event({
            signal: abort.signal,
            onSseError: (error) => {
              if (abort.signal.aborted) return
              setLiveSyncState("reconnecting")
              setLiveSyncDetail(explainError(error))
            },
          })

          hasConnected = true
          setLiveSyncState("live")
          setLiveSyncDetail("Live sync live")

          for await (const event of events.stream) {
            if (abort.signal.aborted) return
            handleLiveEvent(event)
          }
        } catch (error) {
          if (abort.signal.aborted) return
          hasConnected = true
          setLiveSyncState("error")
          setLiveSyncDetail(explainError(error))
        }

        if (abort.signal.aborted) return
        await wait(LIVE_RECONNECT_MS)
      }
    })()

    onCleanup(() => {
      abort.abort()
      clearTimers()
      setLiveSyncState("idle")
      setLiveSyncDetail("Live sync idle")
    })
  })

  onMount(() => {
    void refreshWorkspace()
  })

  function FsTree(props: { entries: FsEntry[]; level?: number }) {
    const level = props.level ?? 0
    return (
      <ul class="wb-fs-list">
        <For each={props.entries}>
          {(entry) => (
            <li>
              <button
                class={`wb-fs-item ${entry.type === "dir" ? "is-dir" : "is-file"} ${fsSelectedPath() === entry.path ? "is-selected" : ""}`}
                type="button"
                style={{ "padding-left": `${0.5 + level * 0.55}rem` }}
                onClick={() => {
                  if (entry.type === "dir") {
                    void refreshFs(entry.path)
                    return
                  }
                  void previewFs(entry.path)
                }}
              >
                <span>{entry.type === "dir" ? "▸" : "•"}</span>
                <span>{entry.name}</span>
                <Show when={entry.type === "file" && entry.size}>
                  <small>{formatBytes(entry.size)}</small>
                </Show>
              </button>
              <Show when={entry.type === "dir" && entry.children && entry.children.length > 0 && level < 1}>
                <FsTree entries={entry.children ?? []} level={level + 1} />
              </Show>
            </li>
          )}
        </For>
      </ul>
    )
  }

  return (
    <div class="wb-shell">
      <div class="wb-backdrop" />
      <header class="wb-header">
        <div>
          <p class="wb-eyebrow">Custom opencode surface</p>
          <h1>Halext Workbench</h1>
          <p class="wb-subtitle">
            A separate UX layer for sessions, project navigation, and AFS-aware workflow that can stay upstream-compatible.
          </p>
        </div>
        <div class="wb-status-cluster">
          <div class="wb-status-chip">
            <span class={`wb-dot ${connectedAfs()?.status.status === "connected" ? "is-live" : ""}`} />
            {connectedAfs() ? `AFS ${summarizeMcpStatus(connectedAfs()!.status)}` : "AFS not detected"}
          </div>
          <div class="wb-status-chip">
            <span class={`wb-dot ${liveSyncState() === "live" ? "is-live" : ""}`} />
            {summarizeLiveSync(liveSyncState(), liveSyncDetail())}
          </div>
          <div class="wb-status-chip">
            <span class={`wb-dot ${afsSummary() && !afsErrorText() ? "is-live" : ""}`} />
            {bridgeStatusText()}
          </div>
          <button class="wb-secondary-button" type="button" onClick={() => void refreshWorkspace()}>
            Refresh
          </button>
        </div>
      </header>

      <section class="wb-connection-panel">
        <label class="wb-field">
          <span>Server URL</span>
          <input value={draftServerUrl()} onInput={(event) => setDraftServerUrl(event.currentTarget.value)} />
        </label>
        <label class="wb-field">
          <span>Bridge URL</span>
          <input
            value={draftBridgeUrl()}
            placeholder={DEFAULT_BRIDGE_URL}
            onInput={(event) => setDraftBridgeUrl(event.currentTarget.value)}
          />
        </label>
        <label class="wb-field">
          <span>Directory</span>
          <input
            value={draftDirectory()}
            placeholder="Optional project path"
            onInput={(event) => setDraftDirectory(event.currentTarget.value)}
          />
        </label>
        <button class="wb-primary-button" type="button" onClick={() => void applyConnection()}>
          Apply
        </button>
      </section>

      <Show when={errorText()}>
        <div class="wb-error-banner">{errorText()}</div>
      </Show>

      <main class="wb-grid">
        <aside class="wb-rail">
          <section class="wb-panel">
            <div class="wb-panel-header">
              <div>
                <p class="wb-panel-kicker">Project rail</p>
                <h2>Projects</h2>
              </div>
              <span class="wb-count">{projects().length}</span>
            </div>
            <div class="wb-list">
              <For each={projects()}>
                {(project) => (
                  <button class="wb-project-card" type="button" onClick={() => void openProject(project)}>
                    <strong>{project.name ?? project.worktree.split("/").at(-1) ?? project.worktree}</strong>
                    <span>{project.worktree}</span>
                  </button>
                )}
              </For>
            </div>
          </section>

          <section class="wb-panel">
            <div class="wb-panel-header">
              <div>
                <p class="wb-panel-kicker">Conversation rail</p>
                <h2>Recent Sessions</h2>
              </div>
              <button class="wb-secondary-button" type="button" onClick={() => void createSession()}>
                New session
              </button>
            </div>
            <Show when={!loadingWorkspace()} fallback={<p class="wb-muted">Loading sessions…</p>}>
              <div class="wb-list">
                <For each={sessions()}>
                  {(session) => (
                    <button
                      class={`wb-session-card ${selectedSessionID() === session.id ? "is-selected" : ""}`}
                      type="button"
                      onClick={() => setSelectedSessionID(session.id)}
                    >
                      {(() => {
                        const pendingCount = pendingPrompts().filter((item) => item.sessionID === session.id).length
                        const activity = sessionActivities()[session.id]
                        const label = summarizeSessionActivity(activity, pendingCount)
                        const tone = sessionActivityTone(activity, pendingCount)
                        return (
                          <>
                      <strong>{session.title}</strong>
                      <span>{session.project?.name ?? session.directory.split("/").at(-1) ?? session.directory}</span>
                      <small>{formatDate(session.time.updated)}</small>
                            <Show when={label !== "Idle"}>
                              <small class={`wb-session-state ${sessionActivityClass(tone)}`}>{label}</small>
                            </Show>
                          </>
                        )
                      })()}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </aside>

        <section class="wb-canvas">
          <div class="wb-panel wb-panel-stretch">
            <div class="wb-panel-header">
              <div>
                <p class="wb-panel-kicker">Session canvas</p>
                <h2>{selectedSession()?.title ?? "No session selected"}</h2>
              </div>
              <Show when={selectedSession()}>
                {(session) => (
                  <div class="wb-canvas-meta">
                    <div class="wb-session-meta">
                      <span>{session().directory}</span>
                      <span>{formatDate(session().time.updated)}</span>
                    </div>
                    <Show when={selectedActivityLabel() !== "Idle"}>
                      <span class={`wb-pill ${sessionActivityClass(selectedActivityTone())}`}>{selectedActivityLabel()}</span>
                    </Show>
                  </div>
                )}
              </Show>
            </div>

            <Show when={selectedSession()} fallback={<div class="wb-empty-state">Pick a session or create one from the rail.</div>}>
              <div class="wb-message-list">
                <Show when={!loadingMessages()} fallback={<p class="wb-muted">Loading messages…</p>}>
                  <For each={messages()}>
                    {(message) => (
                      <article class={`wb-message ${message.info.role === "assistant" ? "is-assistant" : "is-user"}`}>
                        <div class="wb-message-header">
                          <strong>{message.info.role === "assistant" ? "Assistant" : "User"}</strong>
                          <span>{formatDate(message.info.time.created)}</span>
                        </div>
                        <div class="wb-message-body">{renderMessageParts(message.parts)}</div>
                      </article>
                    )}
                  </For>
                  <For each={selectedPendingPrompts()}>
                    {(prompt) => (
                      <article class="wb-message is-user is-pending">
                        <div class="wb-message-header">
                          <strong>You</strong>
                          <span>{formatDate(prompt.created)}</span>
                        </div>
                        <p>{prompt.text}</p>
                        <small class="wb-message-note">Queued for engine delivery</small>
                      </article>
                    )}
                  </For>
                  <Show when={selectedActivityLabel() !== "Idle"}>
                    <article class={`wb-message is-assistant is-activity ${sessionActivityClass(selectedActivityTone())}`}>
                      <div class="wb-message-header">
                        <strong>Engine</strong>
                        <span>{formatDate(selectedActivityUpdatedAt())}</span>
                      </div>
                      <p>{selectedActivityLabel()}</p>
                      <Show when={selectedSessionActivity()?.detail && selectedSessionActivity()?.detail !== selectedActivityLabel()}>
                        <small class="wb-message-note">{selectedSessionActivity()?.detail}</small>
                      </Show>
                    </article>
                  </Show>
                </Show>
              </div>

              <div class="wb-composer">
                <textarea
                  value={draftPrompt()}
                  placeholder="Send a prompt through the engine without inheriting the upstream app layout."
                  onInput={(event) => setDraftPrompt(event.currentTarget.value)}
                />
                <div class="wb-composer-actions">
                  <p class="wb-muted">{composerStatusText()}</p>
                  <button class="wb-primary-button" type="button" disabled={sendingPrompt()} onClick={() => void sendPrompt()}>
                    {sendingPrompt() ? "Sending…" : "Send prompt"}
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </section>

        <aside class="wb-context-lane">
          <section class="wb-panel">
            <div class="wb-panel-header">
              <div>
                <p class="wb-panel-kicker">Engine lane</p>
                <h2>MCP Status</h2>
              </div>
              <span class="wb-count">{mcpEntries().length}</span>
            </div>
            <div class="wb-list">
              <For each={mcpEntries()}>
                {(entry) => (
                  <div class="wb-status-card">
                    <strong>{entry.name}</strong>
                    <span>{summarizeMcpStatus(entry.status)}</span>
                  </div>
                )}
              </For>
            </div>
          </section>

          <section class="wb-panel">
            <div class="wb-panel-header">
              <div>
                <p class="wb-panel-kicker">AFS lane</p>
                <h2>Context + queue</h2>
              </div>
              <span class="wb-count">{afsSummary()?.tasks.total ?? 0} queued</span>
            </div>
            <p class="wb-muted">Target: {activeAfsPath() ? shortenPath(activeAfsPath()) : "Pick a project or directory"}</p>
            <Show when={!appliedBridgeUrl().trim()}>
              <div class="wb-note-card">
                <strong>Bridge not configured</strong>
                <span>Start `bun run dev:bridge`, then point the workbench at it to load AFS bootstrap, task queue, and handoff state.</span>
              </div>
            </Show>
            <Show when={appliedBridgeUrl().trim()}>
              <Show when={!loadingAfsSummary()} fallback={<p class="wb-muted">Loading AFS bootstrap…</p>}>
                <Show when={afsErrorText()}>
                  <div class="wb-inline-error">{afsErrorText()}</div>
                </Show>
                <Show when={afsSummary()}>
                  {(summary) => (
                    <div class="wb-list">
                      <div class="wb-status-card">
                        <strong>{summary().project}</strong>
                        <span>{summary().profile} profile</span>
                        <div class="wb-pill-row">
                          <span class={`wb-pill ${summary().status.index?.stale ? "is-warning" : "is-good"}`}>{summarizeIndex(summary().status)}</span>
                          <span class={`wb-pill ${summary().status.mount_health?.healthy ? "is-good" : "is-warning"}`}>
                            {summary().status.mount_health?.healthy ? "Mounts healthy" : "Mount repair suggested"}
                          </span>
                        </div>
                        <Show when={summarizePhase(summary())}>
                          <small>{summarizePhase(summary())}</small>
                        </Show>
                      </div>

                      <Show when={recommendationPreview().length > 0}>
                        <div class="wb-note-card">
                          <strong>Recommended actions</strong>
                          <ul class="wb-compact-list">
                            <For each={recommendationPreview()}>{(item) => <li>{item}</li>}</For>
                          </ul>
                        </div>
                      </Show>

                      <div class="wb-note-card">
                        <strong>Tasks</strong>
                        <span>{summarizeTaskCounts(summary().tasks).join(" · ") || "No queued tasks"}</span>
                        <Show when={taskPreview().length > 0} fallback={<p class="wb-muted">No pending task preview.</p>}>
                          <ul class="wb-compact-list">
                            <For each={taskPreview()}>
                              {(task) => (
                                <li>
                                  <strong>{task.title}</strong>
                                  <span>{task.status} · p{task.priority}</span>
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                      </div>

                      <Show when={latestHandoff()} fallback={<div class="wb-note-card"><strong>Latest handoff</strong><span>No handoff packet yet.</span></div>}>
                        {(handoff) => (
                          <div class="wb-note-card">
                            <strong>Latest handoff</strong>
                            <span>
                              {handoff().agent_name} · {formatDate(handoff().timestamp)}
                            </span>
                            <ul class="wb-compact-list">
                              <For each={summarizeHandoffItems(handoff())}>{(item) => <li>{item}</li>}</For>
                            </ul>
                          </div>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>
              </Show>
            </Show>
          </section>

          <section class="wb-panel">
            <div class="wb-panel-header">
              <div>
                <p class="wb-panel-kicker">AFS explorer</p>
                <h2>File browser</h2>
              </div>
              <div class="wb-fs-actions">
                <button
                  class={`wb-secondary-button ${fsScope() === "afs" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setFsScope("afs")}
                >
                  AFS focus
                </button>
                <button
                  class={`wb-secondary-button ${fsScope() === "all" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setFsScope("all")}
                >
                  Show all
                </button>
                <button class="wb-secondary-button" type="button" disabled={loadingFs()} onClick={() => void refreshFs()}>
                  {loadingFs() ? "Loading…" : "Refresh tree"}
                </button>
              </div>
            </div>
            <p class="wb-muted">
              Root: {fsRoot() ? shortenPath(fsRoot()) : "No root"} · Target: {fsTarget() ? shortenPath(fsTarget()) : "No target"}
            </p>
            <Show when={fsMounts().length > 0}>
              <div class="wb-pill-row">
                <span class="wb-muted">Context mounts</span>
                <div class="wb-fs-mounts">
                  <For each={fsMounts()}>
                    {(mount) => (
                      <button
                        class="wb-fs-mount-chip"
                        type="button"
                        onClick={() => void refreshFs(`${fsRoot()}/.context/${mount}`)}
                      >
                        {mount === "items" ? "items/tasks" : mount}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <Show when={fsErrorText()}>
              <div class="wb-inline-error">{fsErrorText()}</div>
            </Show>
            <Show when={!loadingFs()} fallback={<p class="wb-muted">Loading file tree…</p>}>
              <Show
                when={fsVisibleEntries().length > 0}
                fallback={<div class="wb-note-card"><span>No files found at current path.</span></div>}
              >
                <div class="wb-fs-tree-wrap">
                  <FsTree entries={fsVisibleEntries()} />
                </div>
              </Show>
            </Show>
            <Show when={fsSelectedPath()}>
              <div class="wb-note-card">
                <strong>Preview</strong>
                <span>{fsPreviewMeta() || shortenPath(fsSelectedPath())}</span>
                <Show when={loadingFsPreview()}>
                  <p class="wb-muted">Loading preview…</p>
                </Show>
                <Show when={!loadingFsPreview() && fsPreview()}>
                  <pre class="wb-part-pre wb-fs-preview">{fsPreview()}</pre>
                </Show>
              </div>
            </Show>
          </section>

          <section class="wb-panel">
            <div class="wb-panel-header">
              <div>
                <p class="wb-panel-kicker">Context pack</p>
                <h2>Session pack preview</h2>
              </div>
              <button class="wb-secondary-button" type="button" disabled={loadingAfsPack()} onClick={() => void buildPackPreview()}>
                {loadingAfsPack() ? "Building…" : "Build preview"}
              </button>
            </div>
            <label class="wb-field">
              <span>Pack query</span>
              <input
                value={packQuery()}
                placeholder="Optional retrieval focus"
                onInput={(event) => setPackQuery(event.currentTarget.value)}
              />
            </label>
            <p class="wb-muted">Runs `afs session pack --no-write-artifacts` through the bridge so the workbench can inspect context without patching opencode.</p>
            <Show when={afsPackErrorText()}>
              <div class="wb-inline-error">{afsPackErrorText()}</div>
            </Show>
            <Show when={afsPack()}>
              {(pack) => (
                <div class="wb-list">
                  <div class="wb-status-card">
                    <strong>{pack().project}</strong>
                    <span>
                      {pack().estimated_tokens.toLocaleString()} / {pack().token_budget.toLocaleString()} tokens · {pack().sources.length} sources
                    </span>
                  </div>
                  <For each={summarizePackBody(pack())}>
                    {(section) => (
                      <div class="wb-note-card">
                        <strong>{section.title}</strong>
                        <span>{truncate(section.body, 220)}</span>
                      </div>
                    )}
                  </For>
                  <Show when={pack().omitted_sections.length > 0}>
                    <div class="wb-note-card">
                      <strong>Omitted for budget</strong>
                      <span>{pack().omitted_sections.join(", ")}</span>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={!afsPack() && !afsPackErrorText()}>
              <div class="wb-note-card">
                <strong>Read-only for now</strong>
                <span>The bridge is scoped to summary and pack reads first. Validation and write flows stay on the next pass.</span>
              </div>
            </Show>
          </section>
        </aside>
      </main>
    </div>
  )
}
