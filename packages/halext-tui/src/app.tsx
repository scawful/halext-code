import {
  createHalextBridgeClient,
  type AfsBootstrapSummary,
  type AfsContextPack,
  type AfsTask,
} from "@halext/bridge"
import {
  createOpencodeClient,
  type GlobalSession,
  type Message,
  type McpStatus,
  type Part,
  type Project,
  type Session,
} from "@opencode-ai/sdk/v2/client"
import { RGBA, TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, onMount, type ParentProps } from "solid-js"

type HalextTuiAppProps = {
  serverUrl: string
  bridgeUrl: string
  directory?: string
}

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

type PendingPrompt = {
  id: string
  sessionID: string
  text: string
  createdAt: number
}

type McpEntry = {
  name: string
  status: McpStatus
}

type PartBlock = {
  label: string
  title: string
  lines: string[]
  tone: RGBA
}

const palette = {
  background: RGBA.fromHex("#0f1115"),
  panel: RGBA.fromHex("#151922"),
  panelAlt: RGBA.fromHex("#10141b"),
  border: RGBA.fromHex("#2d3440"),
  accent: RGBA.fromHex("#d89a59"),
  text: RGBA.fromHex("#f1efe8"),
  muted: RGBA.fromHex("#93a0ac"),
  success: RGBA.fromHex("#7ec699"),
  warning: RGBA.fromHex("#e4b363"),
  error: RGBA.fromHex("#e07a7a"),
} as const

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
  return `${normalized.slice(0, max - 1)}...`
}

function wrapText(text: string, width = 64, maxLines = 4) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return []
  const words = normalized.split(" ")
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > width && current) {
      lines.push(current)
      current = word
      if (lines.length >= maxLines) break
      continue
    }
    current = next
  }
  if (lines.length < maxLines && current) lines.push(current)
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = truncate(lines[maxLines - 1] ?? "", Math.max(12, width - 2))
  }
  return lines
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

function summarizeMcpStatus(status: McpStatus) {
  switch (status.status) {
    case "connected":
      return "connected"
    case "disabled":
      return "disabled"
    case "failed":
      return truncate(status.error, 54)
    case "needs_auth":
      return "needs auth"
    case "needs_client_registration":
      return truncate(status.error, 54)
  }
}

function mcpTone(status: McpStatus) {
  switch (status.status) {
    case "connected":
      return palette.success
    case "failed":
      return palette.error
    default:
      return palette.warning
  }
}

function summarizeIndex(summary?: AfsBootstrapSummary | null) {
  const index = summary?.status?.index
  if (!index) return "Index unknown"
  const entryCount = typeof index.total_entries === "number" ? `${index.total_entries.toLocaleString()} entries` : "entry count unknown"
  if (index.stale) return `Index stale, ${entryCount}`
  if (index.has_entries || index.available || index.enabled) return `Index ready, ${entryCount}`
  return "Index unavailable"
}

function pickTaskPreview(tasks: AfsTask[]) {
  return tasks.filter((task) => task.status !== "done" && task.status !== "completed").slice(0, 4)
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

function promptText(parts: Part[]) {
  return parts
    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
    .filter(Boolean)
    .join("\n")
    .trim()
}

function reconcilePendingPrompts(pending: PendingPrompt[], sessionID: string, nextMessages: SessionMessage[]) {
  const matchedCounts = new Map<string, number>()
  for (const message of nextMessages) {
    if (message.info.role !== "user") continue
    const text = promptText(message.parts)
    if (!text) continue
    matchedCounts.set(text, (matchedCounts.get(text) ?? 0) + 1)
  }

  return pending.filter((item) => {
    if (item.sessionID !== sessionID) return true
    const remaining = matchedCounts.get(item.text) ?? 0
    if (remaining <= 0) return true
    matchedCounts.set(item.text, remaining - 1)
    return false
  })
}

function toGlobalSession(session: Session): GlobalSession {
  return {
    ...session,
    project: null,
  }
}

function upsertSessionRecord(current: GlobalSession[], next: GlobalSession) {
  return [next, ...current.filter((item) => item.id !== next.id)].sort((left, right) => right.time.updated - left.time.updated)
}

function touchSessionRecord(current: GlobalSession[], sessionID: string, updatedAt = Date.now()) {
  return current
    .map((item) => (item.id === sessionID ? { ...item, time: { ...item.time, updated: updatedAt } } : item))
    .sort((left, right) => right.time.updated - left.time.updated)
}

function summarizeToolPart(part: Extract<Part, { type: "tool" }>): PartBlock {
  const tone = part.state.status === "completed" ? palette.success : part.state.status === "error" ? palette.error : palette.warning
  const lines: string[] = []
  if (part.state.status === "completed") {
    lines.push(truncate(part.state.title || "Tool completed", 100))
    if (part.state.output) lines.push(...wrapText(part.state.output, 64, 3))
  } else if (part.state.status === "error") {
    lines.push(...wrapText(part.state.error || "Tool failed", 64, 3))
  } else if (part.state.status === "running") {
    lines.push(truncate(part.state.title || "Tool running", 100))
  } else {
    lines.push("Awaiting execution")
  }
  return {
    label: "tool",
    title: `${part.tool} (${part.state.status})`,
    lines,
    tone,
  }
}

function summarizePart(part: Part): PartBlock[] {
  switch (part.type) {
    case "text": {
      const text = part.text.trim()
      if (!text) return []
      return [
        {
          label: "text",
          title: "Response",
          lines: wrapText(text, 72, 4),
          tone: palette.text,
        },
      ]
    }
    case "reasoning": {
      const text = part.text.trim()
      if (!text) return []
      return [
        {
          label: "reasoning",
          title: "Model thinking",
          lines: wrapText(text, 72, 4),
          tone: palette.warning,
        },
      ]
    }
    case "tool":
      return [summarizeToolPart(part)]
    case "patch":
      return [
        {
          label: "patch",
          title: `Patched ${part.files.length} file${part.files.length === 1 ? "" : "s"}`,
          lines: part.files.slice(0, 4).map((file) => shortenPath(file)),
          tone: palette.success,
        },
      ]
    case "agent":
      return [
        {
          label: "agent",
          title: `Agent @${part.name}`,
          lines: part.source?.value ? wrapText(part.source.value, 72, 2) : ["Agent context attached"],
          tone: palette.accent,
        },
      ]
    case "subtask":
      return [
        {
          label: "subtask",
          title: `Subtask @${part.agent}`,
          lines: [truncate(part.description, 100), ...wrapText(part.prompt, 72, 2)],
          tone: palette.warning,
        },
      ]
    case "file":
      return [
        {
          label: "file",
          title: part.filename || "Attachment",
          lines: [
            part.source?.type === "file" || part.source?.type === "symbol" ? shortenPath(part.source.path) : part.mime,
            part.source?.type === "resource" ? `${part.source.clientName}:${part.source.uri}` : "",
          ].filter(Boolean),
          tone: palette.muted,
        },
      ]
    case "retry":
      return [
        {
          label: "retry",
          title: `Retry ${part.attempt}`,
          lines: wrapText(part.error.data.message, 72, 3),
          tone: palette.error,
        },
      ]
    case "step-start":
      return [
        {
          label: "step",
          title: "Execution step started",
          lines: part.snapshot ? wrapText(part.snapshot, 72, 2) : ["Snapshot pending"],
          tone: palette.muted,
        },
      ]
    case "step-finish": {
      const totalTokens = part.tokens.total ?? part.tokens.input + part.tokens.output + part.tokens.reasoning
      return [
        {
          label: "step",
          title: `Step finished (${part.reason})`,
          lines: [`${totalTokens.toLocaleString()} tokens`, `$${part.cost.toFixed(4)}`],
          tone: palette.muted,
        },
      ]
    }
    case "snapshot":
      return [
        {
          label: "snapshot",
          title: "Context snapshot",
          lines: wrapText(part.snapshot, 72, 2),
          tone: palette.muted,
        },
      ]
    case "compaction":
      return [
        {
          label: "compaction",
          title: part.auto ? "Automatic compaction" : "Manual compaction",
          lines: [part.overflow ? "Overflow triggered" : "Context compacted"],
          tone: palette.warning,
        },
      ]
  }
}

function messageBlocks(message: SessionMessage) {
  const blocks = message.parts.flatMap((part) => summarizePart(part))
  return blocks.length > 0
    ? blocks
    : [
        {
          label: "structured",
          title: "Structured response",
          lines: ["No visible parts yet"],
          tone: palette.muted,
        },
      ]
}

function messageTone(message: SessionMessage) {
  if (message.info.role === "user") return palette.accent
  if (message.info.error) return palette.error
  return palette.success
}

function roleLabel(message: SessionMessage) {
  return message.info.role === "assistant" ? "Assistant" : "You"
}

function Panel(props: ParentProps<{ title: string; subtitle?: string; width?: number | "auto" | `${number}%`; flexGrow?: number }>) {
  return (
    <box
      flexDirection="column"
      width={props.width}
      flexGrow={props.flexGrow ?? 0}
      minHeight={0}
      border={["left"]}
      borderColor={palette.border}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="column" paddingBottom={1}>
        <text fg={palette.accent} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
        <Show when={props.subtitle}>
          <text fg={palette.muted}>{props.subtitle}</text>
        </Show>
      </box>
      <box flexDirection="column" flexGrow={1} minHeight={0} gap={1}>
        {props.children}
      </box>
    </box>
  )
}

export function HalextTuiApp(props: HalextTuiAppProps) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  let composerInput: TextareaRenderable | undefined

  const [projects, setProjects] = createSignal<Project[]>([])
  const [sessions, setSessions] = createSignal<GlobalSession[]>([])
  const [selectedSessionID, setSelectedSessionID] = createSignal("")
  const [messages, setMessages] = createSignal<SessionMessage[]>([])
  const [pendingPrompts, setPendingPrompts] = createSignal<PendingPrompt[]>([])
  const [mcpEntries, setMcpEntries] = createSignal<McpEntry[]>([])
  const [afsSummary, setAfsSummary] = createSignal<AfsBootstrapSummary | null>(null)
  const [afsPack, setAfsPack] = createSignal<AfsContextPack | null>(null)
  const [draftPrompt, setDraftPrompt] = createSignal("")
  const [statusText, setStatusText] = createSignal("Starting halext-tui...")
  const [errorText, setErrorText] = createSignal("")
  const [loadingWorkspace, setLoadingWorkspace] = createSignal(false)
  const [loadingMessages, setLoadingMessages] = createSignal(false)
  const [loadingPack, setLoadingPack] = createSignal(false)
  const [sendingPrompt, setSendingPrompt] = createSignal(false)
  const [composerFocused, setComposerFocused] = createSignal(false)

  const client = createMemo(() =>
    createOpencodeClient({
      baseUrl: props.serverUrl,
      directory: props.directory,
    }),
  )
  const bridgeClient = createMemo(() => createHalextBridgeClient({ baseUrl: props.bridgeUrl }))
  const selectedSession = createMemo(() => sessions().find((session) => session.id === selectedSessionID()))
  const selectedSessionIndex = createMemo(() => sessions().findIndex((session) => session.id === selectedSessionID()))
  const activePath = createMemo(() => props.directory || selectedSession()?.directory || projects()[0]?.worktree || "")
  const afsTasks = createMemo(() => pickTaskPreview(afsSummary()?.tasks.items ?? []))
  const latestHandoff = createMemo(() => {
    const packet = afsSummary()?.handoff
    return packet && packet.available ? packet : null
  })
  const messagePreview = createMemo(() => messages().slice(-8))
  const pendingPromptPreview = createMemo(() => pendingPrompts().filter((item) => item.sessionID === selectedSessionID()).slice(-3))
  const showAfsLane = createMemo(() => dimensions().width >= 128)
  const timelineHasContent = createMemo(() => messagePreview().length > 0 || pendingPromptPreview().length > 0)
  const modeLabel = createMemo(() => (composerFocused() ? "compose" : "navigate"))
  const busyLabel = createMemo(() => {
    if (sendingPrompt()) return "sending prompt"
    if (loadingWorkspace()) return "workspace loading"
    if (loadingMessages()) return "timeline loading"
    if (loadingPack()) return "pack loading"
    return "idle"
  })

  function exitApp() {
    renderer.setTerminalTitle("")
    renderer.destroy()
    queueMicrotask(() => process.exit(0))
  }

  function moveSelection(offset: number) {
    const items = sessions()
    if (items.length === 0) return
    const current = selectedSessionIndex()
    const start = current >= 0 ? current : 0
    const nextIndex = Math.max(0, Math.min(items.length - 1, start + offset))
    setSelectedSessionID(items[nextIndex]?.id ?? "")
    setStatusText(`Selected session ${nextIndex + 1} of ${items.length}.`)
  }

  function focusComposer() {
    setComposerFocused(true)
    queueMicrotask(() => {
      composerInput?.focus()
      composerInput?.gotoLineEnd()
    })
    setStatusText("Compose mode. Enter sends the prompt and Esc returns to navigation.")
  }

  function blurComposer() {
    composerInput?.blur()
    setComposerFocused(false)
    setStatusText("Navigation mode.")
  }

  async function refreshWorkspace() {
    setLoadingWorkspace(true)
    setErrorText("")
    const directory = props.directory || undefined

    const [projectResult, sessionResult, mcpResult] = await Promise.all([
      client().project.list(undefined, { throwOnError: false }),
      client().experimental.session.list(
        {
          directory,
          limit: 24,
          roots: true,
        },
        { throwOnError: false },
      ),
      client().mcp.status(directory ? { directory } : undefined, { throwOnError: false }),
    ])

    if (projectResult.error || sessionResult.error || mcpResult.error) {
      setErrorText(explainError(projectResult.error) || explainError(sessionResult.error) || explainError(mcpResult.error))
      setLoadingWorkspace(false)
      return
    }

    const nextProjects = projectResult.data ?? []
    const nextSessions = sessionResult.data ?? []
    const nextMcpEntries = Object.entries(mcpResult.data ?? {}).map(([name, status]) => ({ name, status }))

    setProjects(nextProjects)
    setSessions(nextSessions)
    setMcpEntries(nextMcpEntries)

    const stillSelected = nextSessions.find((session) => session.id === selectedSessionID())
    const fallback = stillSelected ?? nextSessions[0]
    setSelectedSessionID(fallback?.id ?? "")

    try {
      if (activePath()) {
        const summary = await bridgeClient().getSummary({
          path: directory ?? fallback?.directory ?? nextProjects[0]?.worktree,
          taskLimit: 8,
          messageLimit: 3,
        })
        setAfsSummary(summary)
      } else {
        setAfsSummary(null)
      }
    } catch (error) {
      setErrorText(explainError(error))
    }

    setStatusText(
      `Loaded ${nextProjects.length} project${nextProjects.length === 1 ? "" : "s"}, ${nextSessions.length} session${nextSessions.length === 1 ? "" : "s"}, and ${nextMcpEntries.length} MCP server${nextMcpEntries.length === 1 ? "" : "s"}.`,
    )
    setLoadingWorkspace(false)
  }

  async function refreshMessagesFor(session: GlobalSession, quiet = false) {
    setLoadingMessages(true)
    const result = await client().session.messages(
      {
        sessionID: session.id,
        directory: session.directory,
        limit: 40,
      },
      { throwOnError: false },
    )

    if (result.error) {
      setErrorText(explainError(result.error))
      setLoadingMessages(false)
      return
    }

    const nextMessages = ((result.data ?? []) as Array<{ info: Message; parts: Part[] }>).map((item) => ({
        info: toSessionMessageInfo(item.info),
        parts: item.parts,
      }))

    if (selectedSessionID() === session.id) {
      setMessages(nextMessages)
    }
    setPendingPrompts((current) => reconcilePendingPrompts(current, session.id, nextMessages))
    if (!quiet && selectedSessionID() === session.id) {
      setStatusText(`Loaded timeline for ${session.title}.`)
    }
    setLoadingMessages(false)
  }

  async function refreshMessages() {
    const session = selectedSession()
    if (!session) {
      setMessages([])
      return
    }
    await refreshMessagesFor(session)
  }

  async function createSession() {
    const targetDirectory = activePath() || props.directory || projects()[0]?.worktree
    if (!targetDirectory) {
      setErrorText("Pick a project or set a directory before creating a session.")
      return null
    }

    const result = await client().session.create(
      {
        directory: targetDirectory,
        title: "Halext TUI",
      },
      { throwOnError: false },
    )

    if (result.error || !result.data) {
      setErrorText(explainError(result.error))
      return null
    }

    const created = toGlobalSession(result.data)
    setSessions((current) => upsertSessionRecord(current, created))
    setSelectedSessionID(created.id)
    setStatusText(`Created session ${created.title}.`)
    return created
  }

  async function ensureActiveSession() {
    return selectedSession() ?? (await createSession())
  }

  async function sendPrompt() {
    if (sendingPrompt()) return

    const text = (composerInput?.plainText ?? draftPrompt()).trim()
    if (!text) {
      setStatusText("Type a prompt before sending.")
      return
    }

    const session = await ensureActiveSession()
    if (!session) return

    setSendingPrompt(true)
    setErrorText("")

    const result = await client().session.promptAsync(
      {
        sessionID: session.id,
        directory: session.directory,
        parts: [{ type: "text", text }],
      },
      { throwOnError: false },
    )

    if (result.error) {
      setErrorText(explainError(result.error))
      setSendingPrompt(false)
      return
    }

    const createdAt = Date.now()
    setPendingPrompts((current) => [
      ...current,
      {
        id: `${createdAt}-${Math.random().toString(16).slice(2, 8)}`,
        sessionID: session.id,
        text,
        createdAt,
      },
    ])
    setSessions((current) => touchSessionRecord(current, session.id, createdAt))
    setDraftPrompt("")
    composerInput?.setText("")
    queueMicrotask(() => {
      composerInput?.focus()
      composerInput?.gotoLineEnd()
    })
    setStatusText("Prompt queued. Refreshing the session timeline.")
    setSendingPrompt(false)
    void refreshMessagesFor(session, true)
    setTimeout(() => {
      if (selectedSessionID() === session.id) {
        void refreshMessagesFor(session, true)
      }
    }, 1500)
  }

  async function buildPackPreview() {
    if (!activePath()) {
      setErrorText("Pick a directory or session before building a pack preview.")
      return
    }
    setLoadingPack(true)
    try {
      const pack = await bridgeClient().getPack({
        path: activePath(),
        model: "codex",
        query: "halext tui operator context",
        maxQueryResults: 4,
        maxEmbeddingResults: 0,
        timeoutMs: 60000,
      })
      setAfsPack(pack)
      setStatusText(`Built AFS pack preview with ${pack.sections.length} section${pack.sections.length === 1 ? "" : "s"}.`)
    } catch (error) {
      setErrorText(explainError(error))
    } finally {
      setLoadingPack(false)
    }
  }

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      evt.preventDefault()
      evt.stopPropagation()
      exitApp()
      return
    }
    if (composerFocused()) {
      if (evt.name === "escape") {
        evt.preventDefault()
        evt.stopPropagation()
        blurComposer()
      }
      return
    }
    if (evt.name === "q") {
      evt.preventDefault()
      evt.stopPropagation()
      exitApp()
      return
    }
    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      moveSelection(1)
      return
    }
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      moveSelection(-1)
      return
    }
    if (evt.name === "r") {
      evt.preventDefault()
      void refreshWorkspace()
      return
    }
    if (evt.name === "p") {
      evt.preventDefault()
      void buildPackPreview()
      return
    }
    if (evt.name === "i") {
      evt.preventDefault()
      focusComposer()
      return
    }
    if (evt.name === "n") {
      evt.preventDefault()
      void createSession()
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      void refreshMessages()
    }
  })

  createEffect(() => {
    const session = selectedSession()
    renderer.setTerminalTitle(session ? `halext-tui · ${session.title}` : "halext-tui")
  })

  createEffect(() => {
    const sessionID = selectedSessionID()
    if (!sessionID) {
      setMessages([])
      return
    }
    void refreshMessages()
  })

  onMount(() => {
    void refreshWorkspace()
  })

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={palette.background} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" paddingLeft={1} paddingRight={1} gap={2} flexShrink={0}>
        <text fg={palette.accent} attributes={TextAttributes.BOLD}>
          halext-tui
        </text>
        <text fg={palette.muted}>terminal-first opencode + AFS cockpit</text>
        <box flexGrow={1} />
        <text fg={palette.muted}>{shortenPath(activePath() || props.directory || projects()[0]?.worktree)}</text>
      </box>

      <box flexDirection="row" paddingLeft={1} paddingRight={1} paddingTop={1} gap={2} flexShrink={0}>
        <text fg={sendingPrompt() || loadingWorkspace() || loadingMessages() || loadingPack() ? palette.warning : palette.success}>{busyLabel()}</text>
        <text fg={composerFocused() ? palette.accent : palette.muted}>{modeLabel()}</text>
        <text fg={palette.muted}>{props.serverUrl}</text>
        <text fg={palette.muted}>bridge {props.bridgeUrl}</text>
        <box flexGrow={1} />
        <text fg={palette.muted}>q quit</text>
        <text fg={palette.muted}>j/k select</text>
        <text fg={palette.muted}>i compose</text>
        <text fg={palette.muted}>n new</text>
        <text fg={palette.muted}>r refresh</text>
        <text fg={palette.muted}>p pack</text>
      </box>

      <box flexDirection="row" flexGrow={1} minHeight={0} paddingTop={1} gap={1}>
        <Panel title={`Sessions ${sessions().length}`} subtitle="Recent workspaces and conversations" width={30}>
          <Show when={sessions().length > 0} fallback={<text fg={palette.muted}>No sessions loaded.</text>}>
            <For each={sessions().slice(0, 18)}>
              {(session) => {
                const selected = createMemo(() => selectedSessionID() === session.id)
                return (
                  <box flexDirection="column" paddingBottom={1}>
                    <box flexDirection="row" gap={1}>
                      <text fg={selected() ? palette.accent : palette.muted}>{selected() ? ">" : " "}</text>
                      <text fg={selected() ? palette.text : palette.muted} attributes={selected() ? TextAttributes.BOLD : undefined}>
                        {truncate(session.title, 26)}
                      </text>
                    </box>
                    <box paddingLeft={2} flexDirection="column">
                      <text fg={palette.muted}>{truncate(session.project?.name ?? shortenPath(session.directory), 28)}</text>
                      <text fg={palette.muted}>{formatDate(session.time.updated)}</text>
                    </box>
                  </box>
                )
              }}
            </For>
          </Show>
        </Panel>

        <Panel
          title={selectedSession()?.title ?? "Timeline"}
          subtitle={selectedSession() ? `${shortenPath(selectedSession()?.directory)} · ${formatDate(selectedSession()?.time.updated)}` : "Pick a session with j/k."}
          flexGrow={1}
        >
          <Show when={timelineHasContent()} fallback={<text fg={palette.muted}>No timeline loaded.</text>}>
            <For each={messagePreview()}>
              {(message) => (
                <box flexDirection="column" border={["left"]} borderColor={messageTone(message)} paddingLeft={1} paddingBottom={1}>
                  <box flexDirection="row" gap={1}>
                    <text fg={messageTone(message)} attributes={TextAttributes.BOLD}>
                      {roleLabel(message)}
                    </text>
                    <text fg={palette.muted}>{formatDate(message.info.time.created)}</text>
                  </box>
                  <For each={messageBlocks(message).slice(0, 5)}>
                    {(block) => (
                      <box flexDirection="column" paddingLeft={1} paddingTop={1}>
                        <text fg={block.tone}>
                          [{block.label}] {block.title}
                        </text>
                        <For each={block.lines}>
                          {(line) => <text fg={palette.text}>{line}</text>}
                        </For>
                      </box>
                    )}
                  </For>
                </box>
              )}
            </For>
            <For each={pendingPromptPreview()}>
              {(prompt) => (
                <box flexDirection="column" border={["left"]} borderColor={palette.accent} paddingLeft={1} paddingBottom={1}>
                  <box flexDirection="row" gap={1}>
                    <text fg={palette.accent} attributes={TextAttributes.BOLD}>
                      You
                    </text>
                    <text fg={palette.muted}>{formatDate(prompt.createdAt)}</text>
                    <text fg={palette.warning}>queued</text>
                  </box>
                  <box flexDirection="column" paddingLeft={1} paddingTop={1}>
                    <text fg={palette.accent}>[pending] Prompt queued</text>
                    <For each={wrapText(prompt.text, 72, 4)}>
                      {(line) => <text fg={palette.text}>{line}</text>}
                    </For>
                  </box>
                </box>
              )}
            </For>
          </Show>
        </Panel>

        <Show when={showAfsLane()}>
          <Panel title="AFS lane" subtitle={activePath() ? shortenPath(activePath()) : "No active path"} width={40}>
            <Show when={afsSummary()} fallback={<text fg={palette.muted}>No AFS summary loaded.</text>}>
              <text fg={palette.text}>{summarizeIndex(afsSummary())}</text>
              <text fg={palette.muted}>
                phase{" "}
                {truncate(
                  afsSummary()
                    ?.scratchpad?.state_text?.split("\n")
                    .find((line) => line.trim().toLowerCase().startsWith("- phase:"))
                    ?.split(":")
                    .slice(1)
                    .join(":")
                    .trim() || "unknown",
                  40,
                )}
              </text>
              <Show when={mcpEntries().length > 0}>
                <box flexDirection="column" paddingTop={1}>
                  <text fg={palette.accent} attributes={TextAttributes.BOLD}>
                    MCP
                  </text>
                  <For each={mcpEntries().slice(0, 4)}>
                    {(entry) => (
                      <text fg={mcpTone(entry.status)}>
                        {entry.name}: {summarizeMcpStatus(entry.status)}
                      </text>
                    )}
                  </For>
                </box>
              </Show>
              <Show when={afsTasks().length > 0}>
                <box flexDirection="column" paddingTop={1}>
                  <text fg={palette.accent} attributes={TextAttributes.BOLD}>
                    Tasks
                  </text>
                  <For each={afsTasks()}>
                    {(task) => (
                      <text fg={palette.text}>
                        {task.id}: {truncate(task.title, 34)}
                      </text>
                    )}
                  </For>
                </box>
              </Show>
              <Show when={latestHandoff()}>
                {(handoff) => (
                  <box flexDirection="column" paddingTop={1}>
                    <text fg={palette.accent} attributes={TextAttributes.BOLD}>
                      Handoff
                    </text>
                    <text fg={palette.text}>{handoff().agent_name}</text>
                    <For each={(handoff().next_steps.length > 0 ? handoff().next_steps : handoff().accomplished).slice(0, 3)}>
                      {(line) => <text fg={palette.muted}>{truncate(line, 36)}</text>}
                    </For>
                  </box>
                )}
              </Show>
              <Show when={afsPack()}>
                {(pack) => (
                  <box flexDirection="column" paddingTop={1}>
                    <text fg={palette.accent} attributes={TextAttributes.BOLD}>
                      Pack preview
                    </text>
                    <For each={pack().sections.slice(0, 3)}>
                      {(section) => (
                        <text fg={palette.text}>
                          {truncate(`${section.title} (${section.estimated_tokens}t)`, 36)}
                        </text>
                      )}
                    </For>
                  </box>
                )}
              </Show>
            </Show>
          </Panel>
        </Show>
      </box>

      <box border={["top"]} borderColor={palette.border} paddingLeft={1} paddingRight={1} paddingTop={1} flexShrink={0}>
        <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
          <text fg={palette.accent} attributes={TextAttributes.BOLD}>
            Composer
          </text>
          <text fg={palette.muted}>{composerFocused() ? "Enter send · Esc navigation" : "i compose · n new session"}</text>
        </box>
        <textarea
          ref={(val: TextareaRenderable) => {
            composerInput = val
          }}
          focused={composerFocused()}
          minHeight={3}
          maxHeight={6}
          placeholder={selectedSession() ? "Send a prompt to the active session" : "Press i to compose. A new session will be created on first send."}
          initialValue={draftPrompt()}
          textColor={palette.text}
          focusedTextColor={palette.text}
          cursorColor={palette.accent}
          keyBindings={[{ name: "return", action: "submit" }]}
          onContentChange={setDraftPrompt}
          onSubmit={() => {
            void sendPrompt()
          }}
        />
      </box>

      <box border={["top"]} borderColor={palette.border} paddingLeft={1} paddingRight={1} paddingTop={1} flexShrink={0}>
        <text fg={errorText() ? palette.error : palette.muted}>{errorText() || statusText()}</text>
      </box>
    </box>
  )
}
