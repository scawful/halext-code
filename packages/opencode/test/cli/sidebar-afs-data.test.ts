import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { approvals, COUNT, missions, project, snapshot } from "../../src/cli/cmd/tui/routes/session/sidebar-afs-data"

describe("sidebar AFS data", () => {
  test("accepts only a registered central-context project", () => {
    const value = {
      context_root: resolve("central-context"),
      layout_version: 2,
      project_path: "/workspace/project",
      registered: true,
      scope_id: "project:prj_123",
      project: { project_id: "prj_123" },
    }
    expect(project(value)).toEqual({ root: value.context_root, scope: "project:prj_123" })
    expect(project({ ...value, registered: false })).toBeUndefined()
    expect(project({ ...value, layout_version: 1 })).toBeUndefined()
    expect(project({ ...value, context_root: ".context" })).toBeUndefined()
    expect(project({ ...value, scope_id: "project:other" })).toBeUndefined()
  })

  test("keeps CLI-resolved v1 contexts compatible", () => {
    const root = resolve("legacy-context")
    expect(
      project({
        context_root: root,
        layout_version: 1,
        registered: false,
        scope_id: "common",
        project: null,
      }),
    ).toEqual({ root, scope: "common" })
  })

  test("accepts complete mission arrays and rejects malformed arrays", () => {
    expect(
      missions([
        { mission_id: "one", title: "First", status: "active", next_steps: ["Continue"] },
        { mission_id: "two", title: "Second", status: "blocked", next_steps: [] },
      ]),
    ).toEqual([
      { mission_id: "two", title: "Second", status: "blocked", next_steps: [] },
      { mission_id: "one", title: "First", status: "active", next_steps: ["Continue"] },
    ])
    expect(missions([])).toEqual([])
    expect(
      missions([
        { mission_id: "one", title: "First", status: "active", next_steps: [] },
        { mission_id: "", title: "Missing ID", status: "active", next_steps: [] },
      ]),
    ).toBeUndefined()
    expect(missions({ mission_id: "one" })).toBeUndefined()
  })

  test("prioritizes blocked missions before applying the display limit", () => {
    expect(
      missions([
        { mission_id: "one", title: "First", status: "active", next_steps: [] },
        { mission_id: "two", title: "Second", status: "active", next_steps: [] },
        { mission_id: "three", title: "Third", status: "active", next_steps: [] },
        { mission_id: "blocked", title: "Blocked", status: "blocked", next_steps: [] },
      ])?.map((mission) => mission.mission_id),
    ).toEqual(["blocked", "one", "two"])
  })

  test("validates and caps pending approval counts", () => {
    const pending = Array.from({ length: COUNT + 2 }, (_, index) => ({
      agent: `agent-${index}`,
      action: "deploy",
      status: "pending",
    }))
    pending.push({ agent: "reviewer", action: "deploy", status: "approved" })

    expect(approvals(pending)).toEqual({ count: COUNT, capped: true })
    expect(approvals([])).toEqual({ count: 0, capped: false })
    expect(approvals([...pending, { agent: "", action: "deploy", status: "pending" }])).toBeUndefined()
    expect(approvals({ status: "pending" })).toBeUndefined()
  })

  test("retains last-known attention data and distinguishes a new unavailable workspace", () => {
    const known = snapshot("/one", undefined, {
      missions: [{ mission_id: "one", title: "First", status: "active", next_steps: [] }],
      approvals: { count: 2, capped: false },
    })
    const stale = snapshot("/one", known, {})
    const unavailable = snapshot("/two", stale, {})

    expect(stale.missions).toEqual(known.missions)
    expect(stale.approvals).toEqual(known.approvals)
    expect(stale.stale).toBe(true)
    expect(stale.unavailable).toBe(false)
    expect(unavailable.missions).toEqual([])
    expect(unavailable.unavailable).toBe(true)
  })

  test("keeps last-known attention data when parser validation fails", () => {
    const known = snapshot("/one", undefined, {
      missions: [{ mission_id: "one", title: "First", status: "active", next_steps: [] }],
      approvals: { count: 2, capped: false },
    })
    const stale = snapshot("/one", known, {
      missions: missions([{ mission_id: "", title: "Broken", status: "active", next_steps: [] }]),
      approvals: approvals([{ agent: "", action: "deploy", status: "pending" }]),
    })

    expect(stale.missions).toEqual(known.missions)
    expect(stale.approvals).toEqual(known.approvals)
    expect(stale.stale).toBe(true)
    expect(stale.unavailable).toBe(false)
  })
})
