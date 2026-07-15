import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BridgeApp, DEFAULT_BRIDGE_HOST, approvalArgs, runAfsJson } from "./server"

const originalCli = process.env.AFS_CLI
const paths: string[] = []

async function fakeCli(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "halext-bridge-test-"))
  const path = join(directory, "afs")
  paths.push(directory)
  await writeFile(path, `#!/usr/bin/env bun\n${source}\n`, "utf8")
  await chmod(path, 0o755)
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

test("timeouts escalate to a forced process termination", async () => {
  const directory = await fakeCli(`
process.on("SIGTERM", () => {})
await Bun.write(process.env.FAKE_PID_PATH, String(process.pid))
setInterval(() => {}, 1_000)
`)
  const pidPath = join(directory, "pid")
  process.env.FAKE_PID_PATH = pidPath

  const started = performance.now()
  await expect(runAfsJson([], { timeoutMs: 25 })).rejects.toThrow("AFS command timed out after 25ms")
  expect(performance.now() - started).toBeLessThan(2_500)

  const pid = Number(await readFile(pidPath, "utf8"))
  expect(() => process.kill(pid, 0)).toThrow()
})
