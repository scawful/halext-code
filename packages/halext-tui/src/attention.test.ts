import { describe, expect, test } from "bun:test"
import type { AfsMission } from "@halext/bridge"
import { availability, beginRefresh, firstError, ownsRefresh, prioritize, refreshError } from "./attention"

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

  test("returns the first actual workspace error", () => {
    const sessionError = new Error("session list failed")
    expect(firstError(undefined, sessionError, new Error("MCP failed"))).toBe(sessionError)
    expect(firstError(undefined, "", null)).toBeUndefined()
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

  test("clears a recovered AFS error without hiding an unrelated error", () => {
    const failed = refreshError("", "", "AFS unavailable")
    expect(failed).toEqual({ owned: "AFS unavailable", visible: "AFS unavailable" })
    expect(refreshError(failed.owned, failed.visible, "")).toEqual({ owned: "", visible: "" })
    expect(refreshError(failed.owned, "Prompt failed", "")).toEqual({ owned: "", visible: "Prompt failed" })
    expect(refreshError("", "Prompt failed", "")).toEqual({ owned: "", visible: "Prompt failed" })
    expect(refreshError(failed.owned, "Prompt failed", "AFS still unavailable")).toEqual({
      owned: "AFS still unavailable",
      visible: "Prompt failed",
    })
  })

  test("restores another AFS error after a health error recovers", () => {
    const health = refreshError("", "", "Health unavailable")
    const attention = refreshError("", health.visible, "Attention unavailable")
    const recovered = refreshError(health.owned, health.visible, "", attention.owned)

    expect(attention).toEqual({ owned: "Attention unavailable", visible: "Health unavailable" })
    expect(recovered).toEqual({ owned: "", visible: "Attention unavailable" })
    expect(refreshError(attention.owned, recovered.visible, "")).toEqual({ owned: "", visible: "" })
  })
})
