import { describe, expect, test } from "bun:test"
import { join } from "path"
import { cleanupWindowsTargets, run, WINDOWS_CHILD_LIMIT } from "../../../../.opencode/plugins/afs-context/lib"
import { tmpdir } from "../fixture/fixture"

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("plugin.afs-context bounded runner", () => {
  test("resolves the native Windows process snapshot helper from the plugin", () => {
    const pluginDir = join(import.meta.dir, "../../../../.opencode/plugins/afs-context")
    expect(Bun.resolveSync("@vscode/windows-process-tree", pluginDir)).toContain("@vscode/windows-process-tree")
  })

  test("bounds Windows descendant cleanup without concurrent taskkill fan-out", async () => {
    const targets = Array.from({ length: WINDOWS_CHILD_LIMIT + 2 }, (_, index) => index + 1)
    const seen: number[] = []
    let active = 0
    let maxActive = 0
    const result = await cleanupWindowsTargets(targets, async (pid) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Bun.sleep(1)
      seen.push(pid)
      active -= 1
      return true
    })

    expect(result).toBe("error")
    expect(seen).toEqual(targets.slice(0, WINDOWS_CHILD_LIMIT))
    expect(maxActive).toBe(1)
  })

  test("captures successful output without a shell", async () => {
    const text = await run([process.execPath, "-e", 'console.log("grounded")'], {
      timeout: process.platform === "win32" ? 10_000 : 2_000,
      limit: 1_024,
    })
    expect(text).toBe("grounded")
  })

  test("returns null for nonzero exits", async () => {
    const text = await run([process.execPath, "-e", "process.exit(3)"], {
      timeout: process.platform === "win32" ? 10_000 : 2_000,
      limit: 1_024,
    })
    expect(text).toBeNull()
  })

  test("terminates commands that exceed the output cap", async () => {
    const text = await run([process.execPath, "-e", 'console.log("x".repeat(4096))'], {
      timeout: 2_000,
      limit: 128,
    })
    expect(text).toBeNull()
  })

  test("terminates commands that exceed the timeout", async () => {
    const start = Date.now()
    const text = await run([process.execPath, "-e", "await Bun.sleep(5000)"], {
      timeout: 50,
      limit: 1_024,
    })
    expect(text).toBeNull()
    expect(Date.now() - start).toBeLessThan(2_000)
  })

  test.skipIf(process.platform === "win32")("terminates descendants that inherit stdout", async () => {
    const start = Date.now()
    const text = await run(
      [
        process.execPath,
        "-e",
        `Bun.spawn([process.execPath, "-e", "await Bun.sleep(5000)"], { stdout: "inherit" }); process.exit(0)`,
      ],
      {
        timeout: 50,
        limit: 1_024,
      },
    )
    expect(text).toBeNull()
    expect(Date.now() - start).toBeLessThan(1_000)
  })

  test.skipIf(process.platform === "win32")("terminates descendants that ignore stdio", async () => {
    await using tmp = await tmpdir()
    const marker = join(tmp.path, "descendant.pid")
    const text = await run(
      [
        process.execPath,
        "-e",
        `const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(10000)"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }); await Bun.write(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
      ],
      { timeout: 2_000, limit: 1_024 },
    )

    const pid = Number(await Bun.file(marker).text())
    expect(pid).toBeGreaterThan(0)
    for (let attempt = 0; attempt < 20 && processIsAlive(pid); attempt++) await Bun.sleep(50)
    expect(processIsAlive(pid)).toBeFalse()
    expect(text).toBeNull()
  })

  test.skipIf(process.platform !== "win32")(
    "terminates an inherited-stdout descendant after its direct parent exits",
    async () => {
      await using tmp = await tmpdir()
      const marker = join(tmp.path, "descendant.pid")
      const start = Date.now()
      // Keep the nested process independent of Bun's parent lifecycle so this
      // deterministically exercises the runner's orphan cleanup path.
      const text = await run(
        [
          process.execPath,
          "-e",
          `const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(10000)"], { stdout: "inherit", detached: true }); await Bun.write(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
        ],
        { timeout: 10_000, limit: 1_024 },
      )
      const elapsed = Date.now() - start

      const pid = Number(await Bun.file(marker).text())
      expect(pid).toBeGreaterThan(0)
      for (let attempt = 0; attempt < 20 && processIsAlive(pid); attempt++) await Bun.sleep(250)
      expect(processIsAlive(pid)).toBeFalse()
      expect(text).toBeNull()
      expect(elapsed).toBeLessThan(8_000)
    },
  )
})
