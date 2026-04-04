import { describe, expect, test } from "bun:test"
import { join } from "path"
import { AFSContextPlugin } from "../../../../.opencode/plugins/afs-context"

describe("plugin.afs-context", () => {
  const dir = "/tmp/repo/packages/opencode"
  const root = "/tmp/repo"
  const ctx = "/tmp/repo/.context"

  test("adds repo-local AFS guidance", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: root } as any)
    const out = { system: [] as string[] }
    await plugin["experimental.chat.system.transform"]?.({} as any, out as any)
    expect(out.system).toHaveLength(1)
    expect(out.system[0]).toContain("/afs-brief")
    expect(out.system[0]).toContain("/afs-handoff-create")
    expect(out.system[0]).toContain(ctx)
  })

  test("injects repo-local context_path for supported tools", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: root } as any)
    const out = { args: {} as Record<string, unknown> }
    await plugin["tool.execute.before"]?.({ tool: "afs_local_context_status" } as any, out as any)
    expect(out.args.context_path).toBe(ctx)
  })

  test("normalizes common repo-local context file paths", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: root } as any)
    const out = {
      args: {
        path: "scratchpad/state.md",
        source: ".context/scratchpad/a.md",
        destination: "scratchpad/b.md",
      } as Record<string, unknown>,
    }
    await plugin["tool.execute.before"]?.({ tool: "afs_local_context_move" } as any, out as any)
    expect(out.args.path).toBe(join(ctx, "scratchpad/state.md"))
    expect(out.args.source).toBe(join(root, ".context/scratchpad/a.md"))
    expect(out.args.destination).toBe(join(ctx, "scratchpad/b.md"))
  })

  test("defaults handoff_create agent_name", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: root } as any)
    const out = { args: {} as Record<string, unknown> }
    await plugin["tool.execute.before"]?.({ tool: "afs_local_handoff_create" } as any, out as any)
    expect(out.args.agent_name).toBe("hcode")
    expect(out.args.context_path).toBe(ctx)
  })

  test("annotates status and pack output", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: root } as any)
    const status = { output: "status" }
    const pack = { output: "pack" }
    await plugin["tool.execute.after"]?.({ tool: "afs_local_context_status" } as any, status as any)
    await plugin["tool.execute.after"]?.({ tool: "afs_local_session_pack" } as any, pack as any)
    expect(status.output).toContain("Repo note:")
    expect(pack.output).toContain("artifact")
  })
})
