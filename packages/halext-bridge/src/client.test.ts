import { afterEach, describe, expect, test } from "bun:test"
import { createHalextBridgeClient, parseApprovals, parseHealth, parseMissions, parseSummary } from "./index"

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

describe("bridge response validation", () => {
  test("accepts current mission, approval, and health payloads", () => {
    expect(parseMissions([mission])).toEqual([mission])
    expect(parseApprovals([approval])).toEqual([approval])
    expect(parseHealth(health)).toEqual(health)
    expect(parseSummary(summary)).toEqual(summary)
    expect(parseMissions([{ ...mission, acceptance: undefined }])).toHaveLength(1)
    expect(parseApprovals([{ ...approval, rationale: undefined }])).toHaveLength(1)
  })

  test("rejects malformed payloads before callers receive them", async () => {
    const client = createHalextBridgeClient({ baseUrl: serve(() => Response.json({ unexpected: true })) })

    await expect(client.getMissions()).rejects.toThrow("invalid missions payload")
    await expect(client.getApprovals()).rejects.toThrow("invalid approvals payload")
    await expect(client.getHealth()).rejects.toThrow("invalid health payload")
    await expect(client.getSummary()).rejects.toThrow("invalid summary payload")
  })
})

describe("bridge request lifecycle", () => {
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
