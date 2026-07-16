import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BridgeApp, DEFAULT_BRIDGE_HOST, approvalArgs, runAfsJson, terminate } from "./server"

const originalCli = process.env.AFS_CLI
const originalBin = process.env.AFS_BIN
const paths: string[] = []
const signalTest = process.platform === "win32" ? test.skip : test

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function fakeCli(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "halext-bridge-test-"))
  const script = join(directory, "afs.ts")
  const path = process.platform === "win32" ? join(directory, "afs.cmd") : join(directory, "afs")
  paths.push(directory)
  await writeFile(script, `${source}\n`, "utf8")
  if (process.platform === "win32") {
    await writeFile(path, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`, "utf8")
  } else {
    await writeFile(path, `#!/usr/bin/env bun\n${source}\n`, "utf8")
    await chmod(path, 0o755)
  }
  process.env.AFS_BIN = path
  process.env.AFS_CLI = path
  return directory
}

afterEach(async () => {
  if (originalBin === undefined) delete process.env.AFS_BIN
  else process.env.AFS_BIN = originalBin
  if (originalCli === undefined) delete process.env.AFS_CLI
  else process.env.AFS_CLI = originalCli
  delete process.env.FAKE_PID_PATH
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("approval routing", () => {
  test("uses history whenever completed requests may be returned", () => {
    expect(approvalArgs("pending")).toEqual(["approvals", "list", "--json"])
    expect(approvalArgs("approved")).toEqual(["approvals", "history", "--json"])
    expect(approvalArgs("rejected")).toEqual(["approvals", "history", "--json"])
    expect(approvalArgs()).toEqual(["approvals", "history", "--json"])
  })

  test("returns approved records instead of a false-empty response", async () => {
    await fakeCli(`
const command = Bun.argv.slice(2)
if (command.join(" ") !== "approvals history --json") process.exit(2)
console.log(JSON.stringify([
  { agent: "reviewer", action: "publish", detail: "approved", timestamp: "now", status: "approved", reviewed_by: "human", reviewed_at: "now" },
  { agent: "worker", action: "send", detail: "pending", timestamp: "now", status: "pending", reviewed_by: "", reviewed_at: "" },
]))
`)

    const response = await BridgeApp.request("http://localhost/api/approvals?status=approved")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      {
        agent: "reviewer",
        action: "publish",
        detail: "approved",
        timestamp: "now",
        status: "approved",
        reviewed_by: "human",
        reviewed_at: "now",
      },
    ])
  })
})

describe("AFS response validation", () => {
  test("rejects malformed CLI payloads at the server boundary", async () => {
    await fakeCli("console.log(JSON.stringify({ unexpected: true }))")

    for (const path of [
      "/api/summary",
      "/api/session/pack",
      "/api/missions?status=active",
      "/api/approvals?status=pending",
      "/api/health",
    ]) {
      const response = await BridgeApp.request(`http://localhost${path}`)
      expect(response.status).toBe(502)
      expect((await response.json()).error).toContain("AFS returned an invalid")
    }
  })
})

test("the bridge defaults to loopback", () => {
  expect(DEFAULT_BRIDGE_HOST).toBe("127.0.0.1")
})

test("resolves the AFS CLI portably with AFS_BIN taking priority", async () => {
  process.env.AFS_BIN = "preferred-afs"
  process.env.AFS_CLI = "fallback-afs"
  expect((await (await BridgeApp.request("http://localhost/health")).json()).afs_cli).toBe("preferred-afs")

  delete process.env.AFS_BIN
  expect((await (await BridgeApp.request("http://localhost/health")).json()).afs_cli).toBe("fallback-afs")

  delete process.env.AFS_CLI
  expect((await (await BridgeApp.request("http://localhost/health")).json()).afs_cli).toBe("afs")
})

test("passes AFS arguments without shell interpretation", async () => {
  await fakeCli("console.log(JSON.stringify(Bun.argv.slice(2)))")
  const args = ["literal & value", 'quote"value']
  expect(await runAfsJson<string[]>(args)).toEqual(args)
})

signalTest("timeouts return a bounded gateway error", async () => {
  await fakeCli(`
process.on("SIGTERM", () => {})
setInterval(() => {}, 1_000)
`)

  const started = performance.now()
  await expect(runAfsJson([], { timeoutMs: 100 })).rejects.toThrow("AFS command timed out after 100ms")
  expect(performance.now() - started).toBeLessThan(2_500)
})

test("caps combined stdout and stderr while streaming", async () => {
  process.env.AFS_BIN = process.execPath
  process.env.AFS_CLI = process.execPath
  for (const stream of ["stdout", "stderr"] as const) {
    const started = performance.now()
    await expect(
      runAfsJson(["-e", `process.${stream}.write("x".repeat(4096)); await Bun.sleep(5000)`], {
        timeoutMs: 2_000,
        maxBytes: 128,
      }),
    ).rejects.toThrow("AFS command output exceeded 128 bytes")
    expect(performance.now() - started).toBeLessThan(1_000)
  }
})

test("timeouts terminate descendants after the direct parent exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "halext-bridge-tree-test-"))
  paths.push(directory)
  const pidPath = join(directory, "descendant.pid")
  process.env.AFS_BIN = process.execPath
  process.env.AFS_CLI = process.execPath

  const started = performance.now()
  await expect(
    runAfsJson(
      [
        "-e",
        `const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(10000)"], { stdout: "inherit", stderr: "inherit" }); await Bun.write(${JSON.stringify(pidPath)}, String(child.pid)); process.exit(0)`,
      ],
      { timeoutMs: 200 },
    ),
  ).rejects.toThrow("AFS command timed out after 200ms")
  expect(performance.now() - started).toBeLessThan(2_000)

  const pid = Number(await readFile(pidPath, "utf8"))
  expect(pid).toBeGreaterThan(0)
  for (let attempt = 0; attempt < 20 && alive(pid); attempt++) await Bun.sleep(250)
  expect(alive(pid)).toBeFalse()
})

signalTest("termination kills a running child", async () => {
  const directory = await fakeCli(`
process.on("SIGTERM", () => {})
await Bun.write(process.env.FAKE_PID_PATH, String(process.pid))
setInterval(() => {}, 1_000)
  `)
  const pidPath = join(directory, "pid")
  process.env.FAKE_PID_PATH = pidPath
  const proc = spawn(process.env.AFS_CLI!, [], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  })

  let pid: number | undefined
  for (let attempt = 0; attempt < 100; attempt += 1) {
    pid = Number(await readFile(pidPath, "utf8").catch(() => "")) || undefined
    if (pid !== undefined) break
    await Bun.sleep(10)
  }
  expect(pid).toBeDefined()

  terminate(proc)
  for (let attempt = 0; attempt < 20 && alive(pid!); attempt++) await Bun.sleep(25)
  expect(alive(pid!)).toBeFalse()
})
