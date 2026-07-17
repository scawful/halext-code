import { describe, expect, test } from "bun:test"
import { join, resolve } from "path"
import { path, project } from "./project"

describe("AFS central project", () => {
  const value = {
    context_root: resolve("central-context"),
    layout_version: 2,
    registered: true,
    scope_id: "project:prj_123",
    project: { project_id: "prj_123" },
  }

  test("accepts only registered layout-v2 results", () => {
    expect(project(value)).toEqual({ root: value.context_root, scope: value.scope_id, version: 2 })
    expect(project({ ...value, registered: false })).toBeUndefined()
    expect(project({ ...value, layout_version: 1 })).toBeUndefined()
    expect(project({ ...value, context_root: ".context" })).toBeUndefined()
    expect(project({ ...value, scope_id: "project:other" })).toBeUndefined()
    expect(project({ ...value, project: null })).toBeUndefined()
  })

  test("keeps CLI-resolved v1 contexts compatible for one cycle", () => {
    expect(
      project({
        context_root: value.context_root,
        layout_version: 1,
        registered: false,
        scope_id: "common",
        project: null,
      }),
    ).toEqual({ root: value.context_root, scope: "common", version: 1 })
    expect(project({ ...value, layout_version: 1, registered: false, scope_id: "project:prj_123" })).toBeUndefined()
  })

  test("leaves v2 category paths scoped for AFS", () => {
    const current = project(value)!
    expect(path(current, ".context")).toBe(".context")
    expect(path(current, ".context/scratchpad/note.md")).toBe("scratchpad/note.md")
    expect(path(current, ".context/scratchpad/../../escape.md")).toBe(".context/scratchpad/../../escape.md")
    expect(path(current, "scratchpad/today.md")).toBe("scratchpad/today.md")
    expect(path(current, "scratchpad/../../escape.md")).toBe("scratchpad/../../escape.md")
    expect(path(current, "notes/today.md")).toBe("notes/today.md")
    const exact = resolve("exact.md")
    expect(path(current, exact)).toBe(exact)
  })

  test("normalizes v1 mount paths under the resolved root", () => {
    const current = project({
      context_root: value.context_root,
      layout_version: 1,
      registered: false,
      scope_id: "common",
      project: null,
    })!
    expect(path(current, ".context/scratchpad/note.md")).toBe(join(current.root, "scratchpad/note.md"))
    expect(path(current, "scratchpad/today.md")).toBe(join(current.root, "scratchpad/today.md"))
    expect(path(current, "hivemind/old.jsonl")).toBe(join(current.root, "hivemind/old.jsonl"))
    expect(path(current, "scratchpad/../../escape.md")).toBe(current.root)
  })
})
