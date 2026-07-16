import { describe, expect, test } from "bun:test"
import { join } from "path"
import { run } from "../../../../.opencode/plugins/afs-context/lib"
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
  test("captures successful output without a shell", async () => {
    const text = await run([process.execPath, "-e", 'console.log("grounded")'], {
      timeout: 2_000,
      limit: 1_024,
    })
    expect(text).toBe("grounded")
  })

  test("returns null for nonzero exits", async () => {
    const text = await run([process.execPath, "-e", "process.exit(3)"], {
      timeout: 2_000,
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

  test.skipIf(process.platform !== "win32")(
    "terminates an inherited-stdout descendant after its direct parent exits",
    async () => {
      await using tmp = await tmpdir()
      const marker = join(tmp.path, "descendant.pid")
      const text = await run(
        [
          process.execPath,
          "-e",
          `const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(10000)"], { stdout: "inherit" }); await Bun.write(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
        ],
        { timeout: 500, limit: 1_024 },
      )

      expect(text).toBeNull()
      const pid = Number(await Bun.file(marker).text())
      expect(pid).toBeGreaterThan(0)
      for (let attempt = 0; attempt < 20 && processIsAlive(pid); attempt++) await Bun.sleep(250)
      expect(processIsAlive(pid)).toBeFalse()
    },
  )
})
