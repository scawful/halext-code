export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:4319"

export type AfsTask = {
  id: string
  title: string
  status: string
  assigned_to: string
  created_by: string
  priority: number
  context: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type AfsHandoffPacket = {
  session_id: string
  agent_name: string
  timestamp: string
  accomplished: string[]
  blocked: string[]
  next_steps: string[]
  context_snapshot: Record<string, unknown>
  open_tasks: Array<Record<string, unknown>>
  metadata: Record<string, unknown>
}

export type AfsLatestHandoff = ({ available: true } & AfsHandoffPacket) | { available: false }

export type AfsMission = {
  mission_id: string
  title: string
  status: string
  created_at: string
  updated_at: string
  summary: string
  owner: string
  acceptance?: string
  next_steps: string[]
  blockers: string[]
  linked_sessions: string[]
  linked_handoffs: string[]
  tags: string[]
  log: Array<Record<string, unknown>>
  metadata: Record<string, unknown>
  schema_version: string
}

export type AfsApproval = {
  agent: string
  action: string
  detail: string
  timestamp: string
  status: string
  reviewed_by: string
  reviewed_at: string
  rationale?: string
}

export type AfsHealthScore = {
  category: string
  metric: string
  score: number
  status: string
  message: string
  timestamp: string
  details?: Record<string, unknown>
}

export type AfsHealthSummary = {
  check_level: string
  timestamp: string
  overall_score: number
  overall_status: string
  duration_ms: number
  scores: AfsHealthScore[]
  [key: string]: unknown
}

export type AfsStatusSummary = {
  context_root?: string
  linked_root?: string
  valid?: boolean
  active_profile?: string
  mount_counts: Record<string, number>
  total_files?: number
  mount_health?: {
    healthy?: boolean
    suggested_actions?: string[]
    [key: string]: unknown
  }
  index?: {
    available?: boolean
    enabled?: boolean
    built?: boolean
    has_entries?: boolean
    stale?: boolean
    total_entries?: number
    db_path?: string
    db_size?: number
    db_size_bytes?: number
    [key: string]: unknown
  }
  maintenance?: Record<string, unknown>
  [key: string]: unknown
}

export type AfsScratchpadSummary = {
  path?: string
  state_text?: string
  deferred_text?: string
  other_files?: string[]
  agent_namespaces?: string[]
}

export type AfsBootstrapSummary = {
  context_path: string
  project: string
  profile: string
  startup_sequence?: string[]
  status: AfsStatusSummary
  diff?: Record<string, unknown>
  scratchpad?: AfsScratchpadSummary
  tasks: {
    total: number
    counts: Record<string, number>
    items: AfsTask[]
    error?: string
  }
  hivemind?: {
    recent_count: number
    messages: Array<Record<string, unknown>>
    error?: string
  }
  handoff: AfsLatestHandoff
  recommended_actions: string[]
  artifact_paths?: Record<string, string>
  [key: string]: unknown
}

export type AfsContextPackSection = {
  title: string
  body: string
  priority: number
  sources: string[]
  estimated_tokens: number
}

export type AfsContextPack = {
  context_path: string
  project: string
  profile: string
  model: "generic" | "gemini" | "claude" | "codex"
  query: string
  token_budget: number
  estimated_tokens: number
  guidance: string
  sections: AfsContextPackSection[]
  sources: string[]
  omitted_sections: string[]
  artifact_paths?: Record<string, string>
}

export type SummaryParams = {
  path?: string
  taskLimit?: number
  messageLimit?: number
}

export type PackParams = {
  path?: string
  query?: string
  model?: "generic" | "gemini" | "claude" | "codex"
  tokenBudget?: number
  maxQueryResults?: number
  maxEmbeddingResults?: number
  timeoutMs?: number
}

export type MissionListParams = {
  path?: string
  status?: "active" | "blocked" | "done" | "abandoned"
  limit?: number
}

export type ApprovalListParams = {
  status?: "pending" | "approved" | "rejected"
}

export type FsListParams = {
  path?: string
  root?: string
  depth?: number
  limit?: number
  includeHidden?: boolean
}

export type FsReadParams = {
  path: string
  root?: string
  maxBytes?: number
}

export type FsEntry = {
  name: string
  path: string
  type: "file" | "dir"
  size?: number
  mtime?: number
  children?: FsEntry[]
}

export type FsListResult = {
  root: string
  target: string
  entries: FsEntry[]
}

export type FsReadResult = {
  root: string
  path: string
  mime: string
  truncated: boolean
  size: number
  content: string
}

type RequestParams = Record<string, string | number | undefined>

function normalizeBaseUrl(value: string) {
  return (value || DEFAULT_BRIDGE_URL).replace(/\/+$/, "")
}

function appendParams(search: URLSearchParams, params: RequestParams) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue
    search.set(key, String(value))
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function numericRecord(value: unknown) {
  return record(value) && Object.values(value).every(finite)
}

function stringRecord(value: unknown) {
  return record(value) && Object.values(value).every((item) => typeof item === "string")
}

function task(value: unknown): value is AfsTask {
  if (!record(value)) return false
  if (typeof value.id !== "string" || typeof value.title !== "string" || typeof value.status !== "string") return false
  if (typeof value.assigned_to !== "string" || typeof value.created_by !== "string" || !finite(value.priority))
    return false
  if (!record(value.context) || typeof value.created_at !== "string" || typeof value.updated_at !== "string")
    return false
  return true
}

function handoff(value: unknown): value is AfsLatestHandoff {
  if (!record(value) || typeof value.available !== "boolean") return false
  if (!value.available) return true
  if (
    typeof value.session_id !== "string" ||
    typeof value.agent_name !== "string" ||
    typeof value.timestamp !== "string"
  )
    return false
  if (!strings(value.accomplished) || !strings(value.blocked) || !strings(value.next_steps)) return false
  if (!record(value.context_snapshot) || !Array.isArray(value.open_tasks) || !value.open_tasks.every(record))
    return false
  return record(value.metadata)
}

function scratchpad(value: unknown) {
  if (!record(value)) return false
  if (value.path !== undefined && typeof value.path !== "string") return false
  if (value.state_text !== undefined && typeof value.state_text !== "string") return false
  if (value.deferred_text !== undefined && typeof value.deferred_text !== "string") return false
  if (value.other_files !== undefined && !strings(value.other_files)) return false
  return value.agent_namespaces === undefined || strings(value.agent_namespaces)
}

export function parseSummary(value: unknown): AfsBootstrapSummary {
  if (!record(value)) throw new Error("Bridge returned an invalid summary payload")
  if (
    typeof value.context_path !== "string" ||
    typeof value.project !== "string" ||
    typeof value.profile !== "string"
  ) {
    throw new Error("Bridge returned an invalid summary payload")
  }
  if (!record(value.status) || !numericRecord(value.status.mount_counts)) {
    throw new Error("Bridge returned an invalid summary payload")
  }
  if (value.status.valid !== undefined && typeof value.status.valid !== "boolean") {
    throw new Error("Bridge returned an invalid summary payload")
  }
  if (!record(value.tasks) || !finite(value.tasks.total) || !numericRecord(value.tasks.counts)) {
    throw new Error("Bridge returned an invalid summary payload")
  }
  if (!Array.isArray(value.tasks.items) || !value.tasks.items.every(task) || !handoff(value.handoff)) {
    throw new Error("Bridge returned an invalid summary payload")
  }
  if (!strings(value.recommended_actions)) throw new Error("Bridge returned an invalid summary payload")
  if (value.scratchpad !== undefined && !scratchpad(value.scratchpad)) {
    throw new Error("Bridge returned an invalid summary payload")
  }
  return value as AfsBootstrapSummary
}

function mission(value: unknown): value is AfsMission {
  if (!record(value)) return false
  if (typeof value.mission_id !== "string" || typeof value.title !== "string" || typeof value.status !== "string")
    return false
  if (typeof value.created_at !== "string" || typeof value.updated_at !== "string") return false
  if (typeof value.summary !== "string" || typeof value.owner !== "string" || typeof value.schema_version !== "string")
    return false
  if (value.acceptance !== undefined && typeof value.acceptance !== "string") return false
  if (!strings(value.next_steps) || !strings(value.blockers) || !strings(value.linked_sessions)) return false
  if (!strings(value.linked_handoffs) || !strings(value.tags)) return false
  if (!Array.isArray(value.log) || !value.log.every(record) || !record(value.metadata)) return false
  return true
}

function approval(value: unknown): value is AfsApproval {
  if (!record(value)) return false
  if (typeof value.agent !== "string" || typeof value.action !== "string" || typeof value.detail !== "string")
    return false
  if (typeof value.timestamp !== "string" || typeof value.status !== "string") return false
  if (typeof value.reviewed_by !== "string" || typeof value.reviewed_at !== "string") return false
  return value.rationale === undefined || typeof value.rationale === "string"
}

function score(value: unknown): value is AfsHealthScore {
  if (!record(value)) return false
  if (typeof value.category !== "string" || typeof value.metric !== "string" || typeof value.status !== "string")
    return false
  if (typeof value.message !== "string" || typeof value.timestamp !== "string" || !finite(value.score)) return false
  return value.details === undefined || record(value.details)
}

export function parseMissions(value: unknown): AfsMission[] {
  if (!Array.isArray(value) || !value.every(mission)) throw new Error("Bridge returned an invalid missions payload")
  return value
}

export function parseApprovals(value: unknown): AfsApproval[] {
  if (!Array.isArray(value) || !value.every(approval)) throw new Error("Bridge returned an invalid approvals payload")
  return value
}

export function parseHealth(value: unknown): AfsHealthSummary {
  if (!record(value)) throw new Error("Bridge returned an invalid health payload")
  if (typeof value.check_level !== "string" || typeof value.timestamp !== "string") {
    throw new Error("Bridge returned an invalid health payload")
  }
  if (!finite(value.overall_score) || typeof value.overall_status !== "string" || !finite(value.duration_ms)) {
    throw new Error("Bridge returned an invalid health payload")
  }
  if (!Array.isArray(value.scores) || !value.scores.every(score))
    throw new Error("Bridge returned an invalid health payload")
  return value as AfsHealthSummary
}

function packSection(value: unknown): value is AfsContextPackSection {
  if (!record(value)) return false
  if (typeof value.title !== "string" || typeof value.body !== "string") return false
  if (!finite(value.priority) || !finite(value.estimated_tokens)) return false
  return strings(value.sources)
}

export function parsePack(value: unknown): AfsContextPack {
  if (!record(value)) throw new Error("Bridge returned an invalid session pack payload")
  if (
    typeof value.context_path !== "string" ||
    typeof value.project !== "string" ||
    typeof value.profile !== "string"
  ) {
    throw new Error("Bridge returned an invalid session pack payload")
  }
  if (typeof value.model !== "string" || !["generic", "gemini", "claude", "codex"].includes(value.model)) {
    throw new Error("Bridge returned an invalid session pack payload")
  }
  if (typeof value.query !== "string" || typeof value.guidance !== "string") {
    throw new Error("Bridge returned an invalid session pack payload")
  }
  if (!finite(value.token_budget) || !finite(value.estimated_tokens)) {
    throw new Error("Bridge returned an invalid session pack payload")
  }
  if (!Array.isArray(value.sections) || !value.sections.every(packSection)) {
    throw new Error("Bridge returned an invalid session pack payload")
  }
  if (!strings(value.sources) || !strings(value.omitted_sections)) {
    throw new Error("Bridge returned an invalid session pack payload")
  }
  if (value.artifact_paths !== undefined && !stringRecord(value.artifact_paths)) {
    throw new Error("Bridge returned an invalid session pack payload")
  }
  return value as AfsContextPack
}

type RequestOptions = {
  signal?: AbortSignal
  timeoutMs: number
}

async function requestJson(baseUrl: string, pathname: string, params: RequestParams, options: RequestOptions) {
  const url = new URL(pathname, `${normalizeBaseUrl(baseUrl)}/`)
  appendParams(url.searchParams, params)

  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  let response: Response
  let text: string
  try {
    response = await fetch(url, { signal })
    text = await response.text()
  } catch (error) {
    if (timeout.aborted) throw new Error(`Bridge request timed out after ${options.timeoutMs}ms`)
    if (options.signal?.aborted) throw new Error("Bridge request aborted")
    throw error
  }
  let payload: unknown = null

  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      if (!response.ok) {
        throw new Error(text)
      }
      throw new Error("Bridge returned non-JSON output")
    }
  }

  if (!response.ok) {
    if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
      throw new Error(payload.error)
    }
    throw new Error(`${response.status} ${response.statusText}`)
  }

  return payload
}

export function createHalextBridgeClient(options?: { baseUrl?: string; timeoutMs?: number; signal?: AbortSignal }) {
  const baseUrl = normalizeBaseUrl(options?.baseUrl ?? DEFAULT_BRIDGE_URL)
  const duration = (fallback: number) => {
    const value = options?.timeoutMs
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
  }
  const request = (path: string, params: RequestParams, timeoutMs: number) =>
    requestJson(baseUrl, path, params, { signal: options?.signal, timeoutMs: duration(timeoutMs) })

  return {
    health() {
      return request("/health", {}, 5_000) as Promise<{ ok: true; afs_cli: string; default_path: string; cwd: string }>
    },
    getSummary(params: SummaryParams = {}) {
      return request(
        "/api/summary",
        {
          path: params.path,
          task_limit: params.taskLimit,
          message_limit: params.messageLimit,
        },
        12_000,
      ).then(parseSummary)
    },
    getPack(params: PackParams = {}) {
      return request(
        "/api/session/pack",
        {
          path: params.path,
          query: params.query,
          model: params.model,
          token_budget: params.tokenBudget,
          max_query_results: params.maxQueryResults,
          max_embedding_results: params.maxEmbeddingResults,
          timeout_ms: params.timeoutMs,
        },
        (params.timeoutMs ?? 60_000) + 2_000,
      ).then(parsePack)
    },
    getMissions(params: MissionListParams = {}) {
      return request(
        "/api/missions",
        {
          path: params.path,
          status: params.status,
          limit: params.limit,
        },
        12_000,
      ).then(parseMissions)
    },
    getApprovals(params: ApprovalListParams = {}) {
      return request(
        "/api/approvals",
        {
          status: params.status,
        },
        12_000,
      ).then(parseApprovals)
    },
    getHealth() {
      return request("/api/health", {}, 22_000).then(parseHealth)
    },
    getFsList(params: FsListParams = {}) {
      return request(
        "/api/fs/list",
        {
          path: params.path,
          root: params.root,
          depth: params.depth,
          limit: params.limit,
          include_hidden: params.includeHidden ? 1 : undefined,
        },
        15_000,
      ) as Promise<FsListResult>
    },
    getFsRead(params: FsReadParams) {
      return request(
        "/api/fs/read",
        {
          path: params.path,
          root: params.root,
          max_bytes: params.maxBytes,
        },
        15_000,
      ) as Promise<FsReadResult>
    },
  }
}
