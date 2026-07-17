import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm } from "fs/promises"
import { tmpdir as osTmpdir } from "os"
import { join, parse } from "path"
import { AFSContextPlugin } from "../../../../.opencode/plugins/afs-context"
import { tmpdir } from "../fixture/fixture"

const env = {
  bin: process.env.AFS_BIN,
  cli: process.env.AFS_CLI,
  log: process.env.HCODE_AFS_TEST_LOG,
  opts: process.env.NODE_OPTIONS,
}
const node = process.platform === "win32" ? "node.exe" : "node"

let fixture: string | undefined

beforeEach(async () => {
  fixture = await mkdtemp(join(osTmpdir(), "hcode-afs-plugin-"))
  const bin = join(fixture, "afs.cjs")
  await Bun.write(
    bin,
    `
if (process.env.HCODE_AFS_TEST_LOG) {
  require("fs").appendFileSync(process.env.HCODE_AFS_TEST_LOG, JSON.stringify(process.argv.slice(1)) + "\\n")
}
if (require("path").basename(process.argv[1] ?? "") === "projects") {
  require("fs").writeSync(1, JSON.stringify({
    context_root: ${JSON.stringify(join(parse(process.cwd()).root, "tmp", "repo", ".context"))},
    layout_version: 1,
    registered: false,
    scope_id: "common",
    project: null,
  }) + "\\n")
}
process.exit(0)
`,
  )
  // The bounded runner intentionally rejects batch files, so use a native
  // executable with a preload hook instead of a platform-specific launcher.
  process.env.AFS_BIN = node
  process.env.NODE_OPTIONS = [env.opts, `--require=${JSON.stringify(bin.replaceAll("\\", "/"))}`]
    .filter(Boolean)
    .join(" ")
})

afterEach(async () => {
  if (env.bin === undefined) delete process.env.AFS_BIN
  else process.env.AFS_BIN = env.bin
  if (env.cli === undefined) delete process.env.AFS_CLI
  else process.env.AFS_CLI = env.cli
  if (env.log === undefined) delete process.env.HCODE_AFS_TEST_LOG
  else process.env.HCODE_AFS_TEST_LOG = env.log
  if (env.opts === undefined) delete process.env.NODE_OPTIONS
  else process.env.NODE_OPTIONS = env.opts
  if (fixture) await rm(fixture, { recursive: true, force: true })
  fixture = undefined
})

describe("plugin.afs-context", () => {
  const root = join(parse(process.cwd()).root, "tmp", "repo")
  const dir = join(root, "packages", "opencode")
  const ctx = join(root, ".context")

  test("adds CLI-resolved AFS guidance", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: root } as any)
    const out = { system: [] as string[] }
    await plugin["experimental.chat.system.transform"]?.({ sessionID: "session-guidance" } as any, out as any)
    expect(out.system).toHaveLength(1)
    expect(out.system[0]).toContain("plain AFS CLI")
    expect(out.system[0]).toContain("start, search, files, notes, handoff, messages")
    expect(out.system[0]).toContain(ctx)
  })

  test("injects repo-local context_path for supported tools", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: root } as any)
    const out = { args: {} as Record<string, unknown> }
    await plugin["tool.execute.before"]?.({ tool: "afs_local_context_status" } as any, out as any)
    expect(out.args.context_path).toBe(ctx)
  })

  test("keeps nested project resolution aligned with the launch directory", async () => {
    const nested = join(root, "packages", "nested")
    const log = join(fixture!, "calls.jsonl")
    process.env.HCODE_AFS_TEST_LOG = log
    const plugin = await AFSContextPlugin({ directory: nested, worktree: root } as any)
    const out = { args: {} as Record<string, unknown> }

    await plugin["tool.execute.before"]?.({ tool: "afs_local_context_status" } as any, out as any)

    expect(out.args.project_path).toBe(nested)
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(calls).toHaveLength(1)
    expect(parse(calls[0]?.[0] ?? "").base).toBe("projects")
    expect(calls[0]?.slice(1)).toEqual(["current", "--path", nested, "--json"])
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

  test("keeps absolute paths unchanged and normalizes .context root path", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: root } as any)
    const abs = join(parse(root).root, "tmp", "elsewhere", "file.md")
    const out = {
      args: {
        path: abs,
        source: ".context",
        destination: "history/events.jsonl",
      } as Record<string, unknown>,
    }
    await plugin["tool.execute.before"]?.({ tool: "afs_local_context_move" } as any, out as any)
    expect(out.args.path).toBe(abs)
    expect(out.args.source).toBe(join(root, ".context"))
    expect(out.args.destination).toBe(join(ctx, "history/events.jsonl"))
  })

  test("defaults handoff_create agent_name", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: root } as any)
    const out = { args: {} as Record<string, unknown> }
    await plugin["tool.execute.before"]?.({ tool: "afs_local_handoff_create" } as any, out as any)
    expect(out.args.agent_name).toBe("hcode")
    expect(out.args.context_path).toBe(ctx)
  })

  test.skipIf(process.platform === "win32")("injects the registered v2 scope into scoped AFS tools", async () => {
    await using tmp = await tmpdir()
    const context = join(tmp.path, "central-context")
    const bin = join(tmp.path, "afs")
    await mkdir(context)
    await Bun.write(
      bin,
      `#!/usr/bin/env bun
console.log(JSON.stringify({
  context_root: ${JSON.stringify(context)},
  layout_version: 2,
  registered: true,
  scope_id: "project:prj_test",
  project: { project_id: "prj_test" },
}))
`,
    )
    await chmod(bin, 0o755)
    process.env.AFS_BIN = bin

    const plugin = await AFSContextPlugin({ directory: tmp.path, worktree: tmp.path } as any)
    for (const tool of [
      "afs_local_context_search",
      "afs_local_messages_send",
      "afs_local_messages_read",
      "afs_local_note_create",
      "afs_local_note_read",
      "afs_local_note_list",
      "afs_local_handoff_create",
      "afs_local_handoff_revise",
      "afs_local_handoff_read",
      "afs_local_handoff_list",
      "afs_local_handoff_threads",
      "afs_local_handoff_ack",
      "afs_local_handoff_close",
    ]) {
      const out = { args: {} as Record<string, unknown> }
      await plugin["tool.execute.before"]?.({ tool } as any, out as any)
      expect(out.args.context_path).toBe(context)
      expect(out.args.project_path).toBe(tmp.path)
    }

    for (const tool of [
      "afs_local_fs_read",
      "afs_local_fs_write",
      "afs_local_fs_delete",
      "afs_local_fs_move",
      "afs_local_fs_list",
    ]) {
      const out = { args: { path: ".context/scratchpad/note.md" } as Record<string, unknown> }
      await plugin["tool.execute.before"]?.({ tool } as any, out as any)
      expect(out.args.project_path).toBe(tmp.path)
      expect(out.args.context_path).toBe(context)
      expect(out.args.path).toBe("scratchpad/note.md")
    }
  })

  test("annotates status, refresh, and pack output", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: root } as any)
    const status = { output: "status" }
    const refresh = { output: "refresh" }
    const pack = { output: "pack" }
    await plugin["tool.execute.after"]?.({ tool: "afs_local_context_status" } as any, status as any)
    await plugin["tool.execute.after"]?.({ tool: "afs_local_context_index_rebuild" } as any, refresh as any)
    await plugin["tool.execute.after"]?.({ tool: "afs_local_session_pack" } as any, pack as any)
    expect(status.output).toContain("Repo note:")
    expect(refresh.output).toContain("AFS-resolved context index")
    expect(pack.output).toContain("artifact")
  })

  test("resolves AFS through the CLI for the non-project worktree sentinel", async () => {
    const plugin = await AFSContextPlugin({ directory: dir, worktree: "/" } as any)
    const out = { args: {} as Record<string, unknown> }
    await plugin["tool.execute.before"]?.({ tool: "afs_local_context_status" } as any, out as any)
    expect(out.args.context_path).toBe(ctx)
  })

  test.skipIf(process.platform === "win32")(
    "loads grounding once per session with AFS_BIN and AFS_CLI routing",
    async () => {
      await using tmp = await tmpdir()
      const context = join(tmp.path, ".context")
      const count = join(tmp.path, "count")
      const bin = join(tmp.path, "afs")
      await mkdir(context)
      await Bun.write(
        bin,
        `#!/usr/bin/env bun\nimport { appendFileSync } from "fs"\nif (process.argv.includes("projects")) {\n  console.log(JSON.stringify({ context_root: ${JSON.stringify(context)}, layout_version: 1, registered: false, scope_id: "common", project: null }))\n} else {\n  appendFileSync(${JSON.stringify(count)}, "1\\n")\n  console.log("grounding:" + process.argv.at(-1))\n}\n`,
      )
      await chmod(bin, 0o755)
      process.env.AFS_BIN = bin
      process.env.AFS_CLI = "/not/the/selected/binary"

      const plugin = await AFSContextPlugin({ directory: tmp.path, worktree: tmp.path } as any)
      for (const sessionID of ["session-a", "session-b", "session-a"]) {
        const out = { system: [] as string[] }
        await plugin["experimental.chat.system.transform"]?.({ sessionID } as any, out as any)
        expect(out.system.at(-1)).toBe(`grounding:${tmp.path}`)
      }

      delete process.env.AFS_BIN
      process.env.AFS_CLI = bin
      const fallback = { system: [] as string[] }
      const fallbackPlugin = await AFSContextPlugin({ directory: tmp.path, worktree: tmp.path } as any)
      await fallbackPlugin["experimental.chat.system.transform"]?.({ sessionID: "session-c" } as any, fallback as any)
      expect(fallback.system.at(-1)).toBe(`grounding:${tmp.path}`)

      const out = { system: [] as string[] }
      await plugin["experimental.chat.system.transform"]?.({} as any, out as any)
      expect(out.system).toHaveLength(0)
      expect((await readFile(count, "utf8")).trim().split("\n")).toHaveLength(3)
    },
  )

  test.skipIf(process.platform === "win32")("caches empty grounding and coalesces concurrent transforms", async () => {
    await using tmp = await tmpdir()
    const context = join(tmp.path, ".context")
    const count = join(tmp.path, "count")
    const bin = join(tmp.path, "afs")
    await mkdir(context)
    await Bun.write(
      bin,
      `#!/usr/bin/env bun\nimport { appendFileSync } from "fs"\nif (process.argv.includes("projects")) {\n  console.log(JSON.stringify({ context_root: ${JSON.stringify(context)}, layout_version: 1, registered: false, scope_id: "common", project: null }))\n} else {\n  appendFileSync(${JSON.stringify(count)}, "1\\n")\n  await Bun.sleep(100)\n}\n`,
    )
    await chmod(bin, 0o755)
    process.env.AFS_BIN = bin

    const plugin = await AFSContextPlugin({ directory: tmp.path, worktree: tmp.path } as any)
    const run = async () => {
      const out = { system: [] as string[] }
      await plugin["experimental.chat.system.transform"]?.({ sessionID: "session-empty" } as any, out as any)
      expect(out.system).toHaveLength(1)
    }
    await Promise.all([run(), run()])
    await run()
    expect((await readFile(count, "utf8")).trim().split("\n")).toHaveLength(1)
  })
})
