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

export type AfsStatusSummary = {
  context_root?: string
  linked_root?: string
  valid: boolean
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

async function requestJson<T>(baseUrl: string, pathname: string, params: RequestParams = {}) {
  const url = new URL(pathname, `${normalizeBaseUrl(baseUrl)}/`)
  appendParams(url.searchParams, params)

  const response = await fetch(url)
  const text = await response.text()
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

  return payload as T
}

export function createHalextBridgeClient(options?: { baseUrl?: string }) {
  const baseUrl = normalizeBaseUrl(options?.baseUrl ?? DEFAULT_BRIDGE_URL)

  return {
    health() {
      return requestJson<{ ok: true; afs_cli: string; default_path: string; cwd: string }>(baseUrl, "/health")
    },
    getSummary(params: SummaryParams = {}) {
      return requestJson<AfsBootstrapSummary>(baseUrl, "/api/summary", {
        path: params.path,
        task_limit: params.taskLimit,
        message_limit: params.messageLimit,
      })
    },
    getPack(params: PackParams = {}) {
      return requestJson<AfsContextPack>(baseUrl, "/api/session/pack", {
        path: params.path,
        query: params.query,
        model: params.model,
        token_budget: params.tokenBudget,
        max_query_results: params.maxQueryResults,
        max_embedding_results: params.maxEmbeddingResults,
        timeout_ms: params.timeoutMs,
      })
    },
    getFsList(params: FsListParams = {}) {
      return requestJson<FsListResult>(baseUrl, "/api/fs/list", {
        path: params.path,
        root: params.root,
        depth: params.depth,
        limit: params.limit,
        include_hidden: params.includeHidden ? 1 : undefined,
      })
    },
    getFsRead(params: FsReadParams) {
      return requestJson<FsReadResult>(baseUrl, "/api/fs/read", {
        path: params.path,
        root: params.root,
        max_bytes: params.maxBytes,
      })
    },
  }
}
