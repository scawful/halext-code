import { afterEach, describe, expect, test } from "bun:test"
import {
  createHalextBridgeClient,
  DISPLAY_TEXT_LIMIT,
  MISSION_TITLE_LIMIT,
  parseApprovals,
  parseHealth,
  parseMissions,
  parsePack,
  parseSummary,
  safeDisplayText,
} from "./index"

const servers: Array<ReturnType<typeof Bun.serve>> = []

function serve(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })
  servers.push(server)
  return server.url.toString()
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
})

const mission = {
  mission_id: "mission_one",
  title: "Review attention surfaces",
  status: "blocked",
  created_at: "2026-07-15T00:00:00Z",
  updated_at: "2026-07-15T00:00:00Z",
  summary: "Keep blockers visible.",
  owner: "reviewer",
  acceptance: "Blocked work is prioritized.",
  next_steps: ["Fix ordering"],
  blockers: ["Ordering"],
  linked_sessions: [],
  linked_handoffs: [],
  tags: ["attention"],
  log: [],
  metadata: {},
  schema_version: "1",
}

const approval = {
  agent: "worker",
  action: "publish",
  detail: "Publish the release.",
  timestamp: "2026-07-15T00:00:00Z",
  status: "pending",
  reviewed_by: "",
  reviewed_at: "",
  rationale: "",
}

const health = {
  check_level: "basic",
  timestamp: "2026-07-15T00:00:00Z",
  overall_score: 0.9,
  overall_status: "good",
  duration_ms: 12,
  scores: [
    {
      category: "system",
      metric: "cpu_usage",
      score: 0.9,
      status: "good",
      message: "CPU healthy",
      timestamp: "2026-07-15T00:00:00Z",
      details: {},
    },
  ],
}

const summary = {
  context_path: "/workspace/.context",
  project: "workspace",
  profile: "dev",
  status: {
    valid: true,
    mount_counts: { knowledge: 1 },
  },
  tasks: {
    total: 0,
    counts: {},
    items: [],
  },
  handoff: { available: false as const },
  recommended_actions: [],
}

const pack = {
  context_path: "/workspace/.context",
  project: "workspace",
  profile: "dev",
  model: "codex" as const,
  query: "review attention",
  token_budget: 2_000,
  estimated_tokens: 40,
  guidance: "Use the focused pack.",
  sections: [
    {
      title: "Attention",
      body: "Review the active mission.",
      priority: 10,
      sources: ["scratchpad/state.md"],
      estimated_tokens: 8,
    },
  ],
  sources: ["scratchpad/state.md"],
  omitted_sections: [],
  artifact_paths: { context: "/workspace/.context" },
}

describe("bridge response validation", () => {
  test("accepts current mission, approval, and health payloads", () => {
    expect(parseMissions([mission])).toEqual([mission])
    expect(parseApprovals([approval])).toEqual([approval])
    expect(parseHealth(health)).toEqual(health)
    expect(parseSummary(summary)).toEqual(summary)
    expect(parsePack(pack)).toEqual(pack)
    expect(parseMissions([{ ...mission, acceptance: undefined }])).toHaveLength(1)
    expect(parseApprovals([{ ...approval, rationale: undefined }])).toHaveLength(1)
  })

  test("rejects non-string session pack models", () => {
    expect(() => parsePack({ ...pack, model: ["codex"] })).toThrow("invalid session pack payload")
  })

  test("rejects malformed payloads before callers receive them", async () => {
    const client = createHalextBridgeClient({ baseUrl: serve(() => Response.json({ unexpected: true })) })

    await expect(client.getMissions()).rejects.toThrow("invalid missions payload")
    await expect(client.getApprovals()).rejects.toThrow("invalid approvals payload")
    await expect(client.getHealth()).rejects.toThrow("invalid health payload")
    await expect(client.getSummary()).rejects.toThrow("invalid summary payload")
    await expect(client.getPack()).rejects.toThrow("invalid session pack payload")
  })

  test("bounds and control-sanitizes display fields at the bridge boundary", () => {
    const title = `${"A".repeat(MISSION_TITLE_LIMIT)}\u001b[31m`
    const detail = `${"B".repeat(DISPLAY_TEXT_LIMIT)}\u202ehidden`
    const parsedMission = parseMissions([{ ...mission, title, next_steps: ["line\u000anext"] }])[0]!
    const parsedApproval = parseApprovals([{ ...approval, agent: "worker\u001b", detail }])[0]!

    expect(Array.from(parsedMission.title)).toHaveLength(MISSION_TITLE_LIMIT)
    expect(parsedMission.title.endsWith("…")).toBeTrue()
    expect(parsedMission.next_steps).toEqual(["line\\u000anext"])
    expect(parsedApproval.agent).toBe("worker\\u001b")
    expect(Array.from(parsedApproval.detail)).toHaveLength(DISPLAY_TEXT_LIMIT)
    expect(parsedApproval.detail.endsWith("…")).toBeTrue()
    expect(parsedApproval.detail).not.toContain("\u202e")
    expect(safeDisplayText("safe")).toBe("safe")
  })
})

describe("bridge request lifecycle", () => {
  test("bounds and control-sanitizes server error summaries", async () => {
    const detail = `${"x".repeat(DISPLAY_TEXT_LIMIT)}\u001b[31m`
    const client = createHalextBridgeClient({
      baseUrl: serve(() => Response.json({ error: detail }, { status: 502 })),
    })

    const error = await client.getMissions().catch((value) => value)
    expect(error).toBeInstanceOf(Error)
    expect(Array.from(error.message)).toHaveLength(DISPLAY_TEXT_LIMIT)
    expect(error.message.endsWith("…")).toBeTrue()
    expect(error.message).not.toContain("\u001b")
  })

  test("aborts a request at the client timeout", async () => {
    const url = serve(async () => {
      await Bun.sleep(500)
      return Response.json(health)
    })
    const client = createHalextBridgeClient({ baseUrl: url, timeoutMs: 50 })

    await expect(client.getHealth()).rejects.toThrow("Bridge request timed out after 50ms")
  })

  test("honors a caller abort signal", async () => {
    const url = serve(async () => {
      await Bun.sleep(500)
      return Response.json(health)
    })
    const abort = new AbortController()
    const client = createHalextBridgeClient({ baseUrl: url, timeoutMs: 1_000, signal: abort.signal })
    const result = client.getHealth()
    abort.abort()

    await expect(result).rejects.toThrow("Bridge request aborted")
  })
})
