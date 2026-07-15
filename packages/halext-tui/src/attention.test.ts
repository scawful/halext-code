import { describe, expect, test } from "bun:test"
import type { AfsMission } from "@halext/bridge"
import { availability, beginRefresh, ownsRefresh, prioritize } from "./attention"

function mission(mission_id: string, status: string): AfsMission {
  return {
    mission_id,
    title: mission_id,
    status,
    created_at: "now",
    updated_at: "now",
    summary: "",
    owner: "reviewer",
    next_steps: [],
    blockers: [],
    linked_sessions: [],
    linked_handoffs: [],
    tags: [],
    log: [],
    metadata: {},
    schema_version: "1",
  }
}

describe("AFS attention", () => {
  test("prioritizes blocked missions before limiting the cockpit", () => {
    const items = [mission("active-one", "active"), mission("active-two", "active"), mission("blocked", "blocked")]
    expect(prioritize(items, 2).map((item) => item.mission_id)).toEqual(["blocked", "active-one"])
  })

  test("distinguishes unavailable data from stale last-known data", () => {
    expect(availability([false, false, false], [true, true, true])).toBe("ready")
    expect(availability([false, true, false], [true, true, true])).toBe("stale")
    expect(availability([false, true, false], [true, false, true])).toBe("unavailable")
  })

  test("binds results to the latest generation and visible path", () => {
    const initial = { generation: 0, path: "" }
    const first = beginRefresh(initial, "/one")
    const second = beginRefresh(first.ticket, "/two")
    const repeated = beginRefresh(second.ticket, "/two")

    expect(first.reset).toBe(true)
    expect(second.reset).toBe(true)
    expect(repeated.reset).toBe(false)
    expect(ownsRefresh(second.ticket, first.ticket, "/two")).toBe(false)
    expect(ownsRefresh(second.ticket, second.ticket, "/one")).toBe(false)
    expect(ownsRefresh(second.ticket, second.ticket, "/two")).toBe(true)
    expect(ownsRefresh(repeated.ticket, second.ticket, "/two")).toBe(false)
  })

  test("rejects older same-path and A-to-B-to-A results", () => {
    const initial = { generation: 0, path: "" }
    const firstA = beginRefresh(initial, "/a").ticket
    const secondA = beginRefresh(firstA, "/a").ticket
    const pathB = beginRefresh(secondA, "/b").ticket
    const thirdA = beginRefresh(pathB, "/a").ticket

    expect(ownsRefresh(secondA, firstA, "/a")).toBe(false)
    expect(ownsRefresh(secondA, secondA, "/a")).toBe(true)
    expect(ownsRefresh(thirdA, firstA, "/a")).toBe(false)
    expect(ownsRefresh(thirdA, thirdA, "/a")).toBe(true)
  })
})
