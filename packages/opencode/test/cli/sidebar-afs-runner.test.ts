import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { run } from "../../src/cli/cmd/tui/routes/session/sidebar-afs-runner"
import { tmpdir } from "../fixture/fixture"

setDefaultTimeout(60_000)

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("sidebar AFS runner", () => {
  test("captures successful output without a shell", async () => {
    const result = await run(["git", "--version"], {
      signal: new AbortController().signal,
      timeout: 10_000,
      limit: 1_024,
    })

    expect(result?.code).toBe(0)
    expect(result?.stdout.toString()).toStartWith("git version ")
  })

  test("passes arguments without shell interpretation", async () => {
    await using tmp = await tmpdir()
    const file = join(tmp.path, process.platform === "win32" ? "afs.cmd" : "afs")
    const script = "console.log(JSON.stringify(process.argv.slice(2)))"
    if (process.platform === "win32") {
      const source = join(tmp.path, "afs.cjs")
      await Bun.write(source, script)
      await Bun.write(file, `@echo off\r\nnode "${source}" %*\r\n`)
    } else {
      await Bun.write(file, `#!/usr/bin/env node\n${script}\n`)
      await chmod(file, 0o755)
    }
    const args = ["literal & value", 'quote"value']
    const result = await run([file, ...args], {
      signal: new AbortController().signal,
      timeout: 10_000,
      limit: 1_024,
    })

    expect(result?.code).toBe(0)
    expect(JSON.parse(result?.stdout.toString() ?? "null")).toEqual(args)
  })

  test("bounds stdout and stderr while they stream", async () => {
    for (const stream of ["stdout", "stderr"] as const) {
      const result = await run(["node", "-e", `process.${stream}.write("x".repeat(4096))`], {
        signal: new AbortController().signal,
        timeout: 10_000,
        limit: 128,
      })

      expect(result).toBeUndefined()
    }
  })

  test("aborts the process tree when a descendant retains the pipes", async () => {
    await using tmp = await tmpdir()
    const marker = join(tmp.path, "descendant.pid")
    const started = performance.now()
    const result = await run(
      [
        "node",
        "-e",
        `const { spawn } = require("node:child_process"); const { writeFileSync } = require("node:fs"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "inherit", detached: process.platform === "win32" }); writeFileSync(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
      ],
      {
        signal: new AbortController().signal,
        timeout: 2_000,
        limit: 1_024,
      },
    )

    expect(result).toBeUndefined()
    expect(performance.now() - started).toBeLessThan(4_000)
    const pid = Number(await Bun.file(marker).text())
    expect(pid).toBeGreaterThan(0)
    for (let attempt = 0; attempt < 20 && alive(pid); attempt++) await Bun.sleep(250)
    expect(alive(pid)).toBeFalse()
  })

  test.skipIf(process.platform === "win32")("rejects a successful parent with ignored-stdio descendants", async () => {
    await using tmp = await tmpdir()
    const marker = join(tmp.path, "descendant.pid")
    const result = await run(
      [
        "node",
        "-e",
        `const { spawn } = require("node:child_process"); const { writeFileSync } = require("node:fs"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" }); writeFileSync(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
      ],
      {
        signal: new AbortController().signal,
        timeout: 2_000,
        limit: 1_024,
      },
    )

    const pid = Number(await Bun.file(marker).text())
    expect(pid).toBeGreaterThan(0)
    for (let attempt = 0; attempt < 20 && alive(pid); attempt++) await Bun.sleep(50)
    expect(alive(pid)).toBeFalse()
    expect(result).toBeUndefined()
  })

  test.skipIf(process.platform !== "win32")(
    "drains ignored-stdio descendants after their direct parent exits",
    async () => {
      await using tmp = await tmpdir()
      const marker = join(tmp.path, "descendant.pid")
      const started = performance.now()
      const result = await run(
        [
          "node",
          "-e",
          `const { spawn } = require("node:child_process"); const { writeFileSync } = require("node:fs"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore", detached: true }); writeFileSync(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
        ],
        {
          signal: new AbortController().signal,
          timeout: 10_000,
          limit: 1_024,
        },
      )
      const elapsed = performance.now() - started

      const pid = Number(await Bun.file(marker).text())
      expect(pid).toBeGreaterThan(0)
      expect(alive(pid)).toBeFalse()
      expect(result).toBeUndefined()
      expect(elapsed).toBeLessThan(8_000)
    },
  )

  test("honors a caller abort before the wall-clock timeout", async () => {
    const abort = new AbortController()
    const started = performance.now()
    const result = run(["node", "-e", "setTimeout(() => {}, 5000)"], {
      signal: abort.signal,
      timeout: 2_000,
      limit: 1_024,
    })
    setTimeout(() => abort.abort(), 25)

    expect(await result).toBeUndefined()
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})
