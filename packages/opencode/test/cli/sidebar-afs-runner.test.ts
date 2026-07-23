import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { join } from "node:path"
import {
  cleanupWindowsTargets,
  run,
  terminateWindowsTargets,
  WINDOWS_TASKKILL_BATCH,
  WINDOWS_TASKKILL_CONCURRENCY,
  windowsDescendants,
} from "../../src/cli/cmd/tui/routes/session/sidebar-afs-runner"
import { tmpdir } from "../fixture/fixture"

setDefaultTimeout(120_000)
const node = process.platform === "win32" ? "node.exe" : "node"

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPid(path: string, timeout = 45_000) {
  const deadline = Date.now() + timeout
  do {
    const pid =
      Number(
        await Bun.file(path)
          .text()
          .catch(() => ""),
      ) || undefined
    if (pid !== undefined) return pid
    await Bun.sleep(25)
  } while (Date.now() < deadline)
}

async function raceWithDeadline<T>(pending: Promise<T>, timeout: number, deadline: symbol) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<typeof deadline>((resolve) => {
    timer = setTimeout(() => resolve(deadline), timeout)
    timer.unref()
  })
  try {
    return await Promise.race([pending, expired])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

describe("sidebar AFS runner", () => {
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

  test("bounds each Windows batch without leaving an unattempted tail", async () => {
    const targets = Array.from(
      { length: WINDOWS_TASKKILL_BATCH * WINDOWS_TASKKILL_CONCURRENCY + 1 },
      (_, index) => index + 1,
    )
    const launches: number[][] = []
    const result = await cleanupWindowsTargets(
      targets,
      async (pids) => {
        launches.push(pids)
        return new Promise<boolean>(() => {})
      },
      10,
    )
    const countAtReturn = launches.length

    expect(result).toBe("error")
    expect(launches.flat().toSorted((left, right) => left - right)).toEqual(targets)
    await Bun.sleep(25)
    expect(launches).toHaveLength(countAtReturn)
  })

  test("snapshots Windows ancestry before killing the root and draining survivors", async () => {
    const order: string[] = []
    const result = await terminateWindowsTargets(
      10,
      async () => {
        order.push("snapshot")
        return [20, 30]
      },
      async (pids, tree) => {
        expect(pids).toEqual([10])
        expect(tree).toBeTrue()
        order.push("root")
        return true
      },
      async (targets) => {
        expect(targets).toEqual([20, 30])
        order.push("drain")
        return "descendants"
      },
    )

    expect(result).toBe("descendants")
    expect(order).toEqual(["snapshot", "root", "drain"])
  })

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
    const script = "console.log(JSON.stringify(process.argv.slice(1)))"
    const args = ["literal&value", "%PATH%", "caret^value", "pipe|value", "redirect>value", 'quote"value']
    const result = await run([node, "-e", script, ...args], {
      signal: new AbortController().signal,
      timeout: 10_000,
      limit: 1_024,
    })

    expect(result?.code).toBe(0)
    expect(JSON.parse(result?.stdout.toString() ?? "null")).toEqual(args)
  })

  test.skipIf(process.platform !== "win32")("rejects Windows batch launchers without executing them", async () => {
    await using tmp = await tmpdir()
    const file = join(tmp.path, "afs.cmd")
    const marker = join(tmp.path, "batch-ran")
    await Bun.write(file, `@echo off\r\necho ran>"${marker}"\r\n`)

    const result = await run([file], {
      signal: new AbortController().signal,
      timeout: 10_000,
      limit: 1_024,
    })

    expect(result).toBeUndefined()
    expect(await Bun.file(marker).exists()).toBeFalse()
  })

  test("bounds stdout and stderr while they stream", async () => {
    await using tmp = await tmpdir()
    for (const stream of ["stdout", "stderr"] as const) {
      const marker = join(tmp.path, `${stream}.pid`)
      const abort = new AbortController()
      const pending = run(
        [
          node,
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); process.${stream}.write("x".repeat(4096)); setInterval(() => {}, 1000)`,
        ],
        {
          signal: abort.signal,
          timeout: 60_000,
          limit: 128,
        },
      )
      const pid = await waitForPid(marker)
      if (pid === undefined) {
        abort.abort()
        await pending
      }
      expect(pid).toBeDefined()

      const deadline = Symbol("output cap deadline")
      const result = await raceWithDeadline(pending, 5_000, deadline)
      if (result === deadline) {
        abort.abort()
        await pending
      }

      expect(result).toBeUndefined()
      for (let attempt = 0; attempt < 20 && alive(pid!); attempt++) await Bun.sleep(250)
      expect(alive(pid!)).toBeFalse()
    }
  })

  test("aborts the process tree when a descendant retains the pipes", async () => {
    await using tmp = await tmpdir()
    const marker = join(tmp.path, "descendant.pid")
    const abort = new AbortController()
    const pending = run(
      [
        "node",
        "-e",
        `const { spawn } = require("node:child_process"); const { writeFileSync } = require("node:fs"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "inherit", detached: process.platform === "win32" }); writeFileSync(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
      ],
      {
        signal: abort.signal,
        timeout: 60_000,
        limit: 1_024,
      },
    )
    const pid = await waitForPid(marker)
    if (pid === undefined) {
      abort.abort()
      await pending
    }
    expect(pid).toBeDefined()

    abort.abort()
    const missed = Symbol("descendant abort did not settle")
    const result = await Promise.race([pending, Promise.resolve(missed)])
    if (result === missed) {
      try {
        process.kill(pid!, "SIGKILL")
      } catch {}
      await pending
    }

    expect(result).toBeUndefined()
    for (let attempt = 0; attempt < 20 && alive(pid!); attempt++) await Bun.sleep(250)
    expect(alive(pid!)).toBeFalse()
  })

  test.skipIf(process.platform === "win32")("rejects a successful parent with ignored-stdio descendants", async () => {
    await using tmp = await tmpdir()
    const marker = join(tmp.path, "descendant.pid")
    const abort = new AbortController()
    const pending = run(
      [
        "node",
        "-e",
        `const { spawn } = require("node:child_process"); const { writeFileSync } = require("node:fs"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" }); writeFileSync(${JSON.stringify(marker)}, String(child.pid)); process.exit(0)`,
      ],
      {
        signal: abort.signal,
        timeout: 60_000,
        limit: 1_024,
      },
    )
    const pid = await waitForPid(marker)
    if (pid === undefined) {
      abort.abort()
      await pending
    }
    expect(pid).toBeDefined()

    const deadline = Symbol("parent-close cleanup deadline")
    const result = await raceWithDeadline(pending, 5_000, deadline)
    if (result === deadline) {
      abort.abort()
      await pending
    }
    expect(result).toBeUndefined()
    for (let attempt = 0; attempt < 20 && alive(pid!); attempt++) await Bun.sleep(50)
    expect(alive(pid!)).toBeFalse()
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
    await using tmp = await tmpdir()
    const marker = join(tmp.path, "abort.pid")
    const abort = new AbortController()
    const pending = run(
      [
        node,
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`,
      ],
      {
        signal: abort.signal,
        timeout: 60_000,
        limit: 1_024,
      },
    )
    const pid = await waitForPid(marker)
    if (pid === undefined) {
      abort.abort()
      await pending
    }
    expect(pid).toBeDefined()

    abort.abort()
    const missed = Symbol("caller abort did not settle")
    const result = await Promise.race([pending, Promise.resolve(missed)])
    if (result === missed) {
      try {
        process.kill(pid!, "SIGKILL")
      } catch {}
      await pending
    }
    expect(result).toBeUndefined()
    for (let attempt = 0; attempt < 20 && alive(pid!); attempt++) await Bun.sleep(250)
    expect(alive(pid!)).toBeFalse()
  })
})
