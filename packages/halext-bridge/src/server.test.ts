import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BridgeApp, DEFAULT_BRIDGE_HOST, approvalArgs, runAfsJson, terminate } from "./server"

const originalCli = process.env.AFS_CLI
const paths: string[] = []
const signalTest = process.platform === "win32" ? test.skip : test

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
  process.env.AFS_CLI = path
  return directory
}

afterEach(async () => {
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

test("the bridge defaults to loopback", () => {
  expect(DEFAULT_BRIDGE_HOST).toBe("127.0.0.1")
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

signalTest("termination escalates after the child reports ready", async () => {
  const directory = await fakeCli(`
process.on("SIGTERM", () => {})
await Bun.write(process.env.FAKE_PID_PATH, String(process.pid))
setInterval(() => {}, 1_000)
`)
  const pidPath = join(directory, "pid")
  process.env.FAKE_PID_PATH = pidPath
  const proc = Bun.spawn({ cmd: [process.env.AFS_CLI!], stdout: "ignore", stderr: "ignore", env: process.env })

  let pid: number | undefined
  for (let attempt = 0; attempt < 100; attempt += 1) {
    pid = Number(await readFile(pidPath, "utf8").catch(() => "")) || undefined
    if (pid !== undefined) break
    await Bun.sleep(10)
  }
  expect(pid).toBeDefined()

  await terminate(proc)
  expect(() => process.kill(pid!, 0)).toThrow()
})
