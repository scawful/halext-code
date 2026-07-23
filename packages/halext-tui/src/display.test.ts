import { describe, expect, test } from "bun:test"
import { DISPLAY_TEXT_LIMIT } from "@halext/bridge"
import { explainError, shortenPath } from "./display"

describe("terminal display boundaries", () => {
  test("shortens POSIX and Windows paths by either separator", () => {
    expect(shortenPath("/one/two/three/four/five")).toBe("/two/three/four/five")
    expect(shortenPath("C:\\one\\two\\three\\four\\five")).toBe("/two/three/four/five")
  })

  test("bounds and control-sanitizes error summaries", () => {
    const summary = explainError(new Error(`${"x".repeat(DISPLAY_TEXT_LIMIT)}\u001b[31m`))

    expect(Array.from(summary)).toHaveLength(DISPLAY_TEXT_LIMIT)
    expect(summary.endsWith("…")).toBeTrue()
    expect(summary).not.toContain("\u001b")
    expect(explainError({ detail: "bad\u202edetail" })).toBe("bad\\u202edetail")
  })

  test("handles unserializable errors without throwing", () => {
    const value: Record<string, unknown> = {}
    value.self = value
    expect(explainError(value)).toBe("Unknown server error")
  })
})
