import { describe, expect, test } from "bun:test"
import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { run } from "../../src/cli/cmd/tui/routes/session/sidebar-afs-runner"
import { tmpdir } from "../fixture/fixture"

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
    const result = await run([process.execPath, "-e", 'console.log("grounded")'], {
      signal: new AbortController().signal,
      timeout: process.platform === "win32" ? 10_000 : 2_000,
      limit: 1_024,
    })

    expect(result?.code).toBe(0)
    expect(result?.stdout.toString().trim()).toBe("grounded")
  })

  test("passes arguments without shell interpretation", async () => {
    await using tmp = await tmpdir()
    const file = join(tmp.path, process.platform === "win32" ? "afs.cmd" : "afs")
    if (process.platform === "win32") {
      await Bun.write(
        file,
        `@echo off\r\n"${process.execPath}" -e "console.log(JSON.stringify(Bun.argv.slice(1)))" %*\r\n`,
      )
    } else {
      await Bun.write(file, "#!/usr/bin/env bun\nconsole.log(JSON.stringify(Bun.argv.slice(2)))\n")
      await chmod(file, 0o755)
    }
    const args = ["literal & value", 'quote"value']
    const result = await run([file, ...args], {
      signal: new AbortController().signal,
      timeout: process.platform === "win32" ? 10_000 : 2_000,
      limit: 1_024,
    })

    expect(result?.code).toBe(0)
    expect(JSON.parse(result?.stdout.toString() ?? "null")).toEqual(args)
  })

  test("bounds stdout and stderr while they stream", async () => {
    for (const stream of ["stdout", "stderr"] as const) {
      const started = performance.now()
      const result = await run(
        [process.execPath, "-e", `process.${stream}.write("x".repeat(4096)); await Bun.sleep(5000)`],
        {
          signal: new AbortController().signal,
          timeout: 10_000,
          limit: 128,
        },
      )

      expect(result).toBeUndefined()
      expect(performance.now() - started).toBeLessThan(5_000)
    }
  })

  test("aborts the process tree when a descendant retains the pipes", async () => {
    await using tmp = await tmpdir()
    const marker = join(tmp.path, "descendant.pid")
    const started = performance.now()
    const result = await run(
      [
        process.execPath,
        "-e",
        `const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(10000)"], { stdout: "inherit", stderr: "inherit" }); await Bun.write(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
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
        process.execPath,
        "-e",
        `const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(10000)"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }); await Bun.write(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
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
          process.execPath,
          "-e",
          `const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(10000)"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }); await Bun.write(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
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
      for (let attempt = 0; attempt < 20 && alive(pid); attempt++) await Bun.sleep(250)
      expect(alive(pid)).toBeFalse()
      expect(result).toBeUndefined()
      expect(elapsed).toBeLessThan(8_000)
    },
  )

  test("honors a caller abort before the wall-clock timeout", async () => {
    const abort = new AbortController()
    const started = performance.now()
    const result = run([process.execPath, "-e", "await Bun.sleep(5000)"], {
      signal: abort.signal,
      timeout: 2_000,
      limit: 1_024,
    })
    setTimeout(() => abort.abort(), 25)

    expect(await result).toBeUndefined()
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})
