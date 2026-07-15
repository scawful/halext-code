import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { approvals, context, COUNT, missions } from "../../src/cli/cmd/tui/routes/session/sidebar-afs-data"
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

  test("accepts only complete visible mission records", () => {
    expect(
      missions([
        { mission_id: "one", title: "First", status: "active", next_steps: ["Continue"] },
        { mission_id: "two", title: "Second", status: "blocked", next_steps: [] },
        { mission_id: "", title: "Missing ID", status: "active", next_steps: [] },
        { mission_id: "three", title: "Wrong status", status: "done", next_steps: [] },
      ]),
    ).toEqual([
      { mission_id: "one", title: "First", status: "active", next_steps: ["Continue"] },
      { mission_id: "two", title: "Second", status: "blocked", next_steps: [] },
    ])
  })

  test("validates and caps pending approval counts", () => {
    const pending = Array.from({ length: COUNT + 2 }, (_, index) => ({
      agent: `agent-${index}`,
      action: "deploy",
      status: "pending",
    }))
    pending.push({ agent: "reviewer", action: "deploy", status: "approved" })
    pending.push({ agent: "", action: "deploy", status: "pending" })

    expect(approvals(pending)).toEqual({ count: COUNT, capped: true })
    expect(approvals({ status: "pending" })).toEqual({ count: 0, capped: false })
  })
})
