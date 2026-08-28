import { describe, expect, test } from "bun:test"
import { AFSContextPlugin, isAFSProjectScopedTool, runBounded } from "../../../../.opencode/plugins/afs-context"

describe("AFS project plugin", () => {
  test("recognizes only scoped tools from the configured AFS server", () => {
    expect(isAFSProjectScopedTool("afs_context_query", "afs")).toBe(true)
    expect(isAFSProjectScopedTool("portable-afs_handoff_create", "portable-afs")).toBe(true)
    expect(isAFSProjectScopedTool("afs_skill_read", "afs")).toBe(false)
    expect(isAFSProjectScopedTool("other_context_query", "afs")).toBe(false)
  })

  test("passes the active directory without supplying a context-root convention", async () => {
    const hooks = await AFSContextPlugin(
      {
        directory: "/workspace/portable-project",
      } as never,
      { serverName: "afs" },
    )
    const output: { args: Record<string, unknown> } = { args: { query: "current work" } }

    await hooks["tool.execute.before"]?.({ tool: "afs_context_query", sessionID: "session", callID: "call" }, output)

    expect(output.args).toEqual({ query: "current work", project_path: "/workspace/portable-project" })
    expect(output.args).not.toHaveProperty("context_path")
  })

  test("bounds successful command output", async () => {
    const output = await runBounded([process.execPath, "-e", "console.log('grounded')"], {
      cwd: import.meta.dir,
      limit: 1024,
    })
    expect(output).toBe("grounded")

    const oversized = await runBounded([process.execPath, "-e", "console.log('x'.repeat(100))"], {
      cwd: import.meta.dir,
      limit: 8,
    })
    expect(oversized).toBeNull()
  })
})
