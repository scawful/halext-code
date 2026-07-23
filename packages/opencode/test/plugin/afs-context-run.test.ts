import { describe, expect, test } from "bun:test"
import { join } from "path"
import {
  cleanupWindowsTargets,
  run,
  WINDOWS_TASKKILL_BATCH,
  WINDOWS_TASKKILL_CONCURRENCY,
  windowsDescendants,
} from "../../../../.opencode/plugins/afs-context/lib"
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
    expect(Bun.resolveSync("@vscode/windows-process-tree", pluginDir)).toBeTruthy()
  })

  test("captures the full Windows descendant tree", () => {
    expect(
      windowsDescendants(
        [
          { pid: 10, ppid: 1 },
          { pid: 20, ppid: 10 },
          { pid: 30, ppid: 20 },
          { pid: 40, ppid: 99 },
        ],
        1,
      ),
    ).toEqual([10, 20, 30])
  })

  test("attempts every bounded Windows target in capped batches", async () => {
    const targets = Array.from({ length: 1_023 }, (_, index) => index + 1)
    const seen: number[] = []
    let active = 0
    let maxActive = 0
    let launches = 0
    const result = await cleanupWindowsTargets(targets, async (pids) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      launches += 1
      await Bun.sleep(1)
      seen.push(...pids)
      active -= 1
      return true
    })

    expect(result).toBe("descendants")
    expect(seen.toSorted((left, right) => left - right)).toEqual(targets)
    expect(launches).toBe(Math.ceil(targets.length / WINDOWS_TASKKILL_BATCH))
    expect(maxActive).toBeLessThanOrEqual(WINDOWS_TASKKILL_CONCURRENCY)
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
