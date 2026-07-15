import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { approvals, context, COUNT, missions, snapshot } from "../../src/cli/cmd/tui/routes/session/sidebar-afs-data"
import { tmpdir } from "../fixture/fixture"

describe("sidebar AFS data", () => {
  test("finds the nearest ancestor context", async () => {
    await using tmp = await tmpdir()
    const parent = join(tmp.path, "project")
    const child = join(parent, "src", "feature")
    await mkdir(join(tmp.path, ".context"))
    await mkdir(join(parent, ".context"), { recursive: true })
    await mkdir(child, { recursive: true })

    expect(context(child)).toBe(parent)
  })

  test("returns undefined without an ancestor context", async () => {
    await using tmp = await tmpdir()
    expect(context(tmp.path)).toBeUndefined()
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
