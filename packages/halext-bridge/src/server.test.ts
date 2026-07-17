import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawn } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BridgeApp, DEFAULT_BRIDGE_HOST, approvalArgs, runAfsJson, shutdownAfsProcesses, terminate } from "./server"

const originalCli = process.env.AFS_CLI
const originalBin = process.env.AFS_BIN
const originalNodeOptions = process.env.NODE_OPTIONS
const paths: string[] = []
const signalTest = process.platform === "win32" ? test.skip : test
const node = process.platform === "win32" ? "node.exe" : "node"

setDefaultTimeout(60_000)

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function fakeCli(source: string, options?: { stayAlive?: boolean }) {
  const directory = await mkdtemp(join(tmpdir(), "halext-bridge-test-"))
  const script = join(directory, "afs.cjs")
  const path = join(directory, "afs")
  paths.push(directory)
  if (process.platform === "win32") {
    const preload = `
const { basename } = require("node:path")
const { writeSync } = require("node:fs")
const args = process.argv.slice(1)
if (args[0]) args[0] = basename(args[0])
process.argv = [process.execPath, __filename, ...args]
delete process.env.NODE_OPTIONS
console.log = (...values) => writeSync(1, values.join(" ") + "\\n")
${source}
${options?.stayAlive ? "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)" : "process.exit(0)"}
`
    await writeFile(script, preload, "utf8")
    process.env.NODE_OPTIONS = `--require "${script.replaceAll("\\", "/")}"`
    process.env.AFS_BIN = node
    process.env.AFS_CLI = node
  } else {
    await writeFile(script, `${source}\n`, "utf8")
    await writeFile(path, `#!/usr/bin/env node\n${source}\n`, "utf8")
    await chmod(path, 0o755)
    process.env.AFS_BIN = path
    process.env.AFS_CLI = path
  }
  return directory
}

async function waitForPid(path: string) {
  const deadline = Date.now() + (process.platform === "win32" ? 10_000 : 2_000)
  do {
    const pid = Number(await readFile(path, "utf8").catch(() => "")) || undefined
    if (pid !== undefined) return pid
    await Bun.sleep(25)
  } while (Date.now() < deadline)
}

afterEach(async () => {
  await shutdownAfsProcesses()
  if (originalBin === undefined) delete process.env.AFS_BIN
  else process.env.AFS_BIN = originalBin
  if (originalCli === undefined) delete process.env.AFS_CLI
  else process.env.AFS_CLI = originalCli
  if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS
  else process.env.NODE_OPTIONS = originalNodeOptions
  delete process.env.FAKE_PID_PATH
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
}, 60_000)

describe("approval routing", () => {
  test("uses history whenever completed requests may be returned", () => {
    expect(approvalArgs("pending")).toEqual(["approvals", "list", "--json"])
    expect(approvalArgs("approved")).toEqual(["approvals", "history", "--json"])
    expect(approvalArgs("rejected")).toEqual(["approvals", "history", "--json"])
    expect(approvalArgs()).toEqual(["approvals", "history", "--json"])
  })

  test("returns approved records instead of a false-empty response", async () => {
    await fakeCli(`
const command = process.argv.slice(2)
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

describe("mission routing", () => {
  test("prefers the plural command and falls back to the compatibility alias", async () => {
    await fakeCli(`
const command = process.argv.slice(2)
if (command[0] === "missions") process.exit(2)
if (command[0] !== "mission") process.exit(3)
console.log("[]")
`)

    const response = await BridgeApp.request("http://localhost/api/missions?status=active")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
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

test.skipIf(process.platform !== "win32")("rejects Windows batch AFS launchers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "halext-bridge-batch-test-"))
  const batch = join(directory, "afs.cmd")
  paths.push(directory)
  await writeFile(batch, "@echo off\r\nexit /b 0\r\n", "utf8")
  process.env.AFS_BIN = batch
  process.env.AFS_CLI = batch

  await expect(runAfsJson([])).rejects.toThrow("set AFS_BIN or AFS_CLI to a native executable")
})

test("passes AFS arguments without shell interpretation", async () => {
  await fakeCli("console.log(JSON.stringify(process.argv.slice(2)))")
  const args = ["literal&value", "%PATH%", "caret^value", "pipe|value", "redirect>value", 'quote"value']
  expect(await runAfsJson<string[]>(args)).toEqual(args)
})

signalTest("timeouts return a bounded gateway error", async () => {
  await fakeCli(
    `
process.on("SIGTERM", () => {})
setInterval(() => {}, 1_000)
`,
    { stayAlive: true },
  )

  const started = performance.now()
  await expect(runAfsJson([], { timeoutMs: 100 })).rejects.toThrow("AFS command timed out after 100ms")
  expect(performance.now() - started).toBeLessThan(2_500)
})

test("caps combined stdout and stderr while streaming", async () => {
  process.env.AFS_BIN = node
  process.env.AFS_CLI = node
  for (const stream of ["stdout", "stderr"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "halext-bridge-cap-test-"))
    const pidPath = join(directory, `${stream}.pid`)
    paths.push(directory)
    await expect(
      runAfsJson(
        [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); process.${stream}.write("x".repeat(4096)); setInterval(() => {}, 1000)`,
        ],
        {
          timeoutMs: 10_000,
          maxBytes: 128,
        },
      ),
    ).rejects.toThrow("AFS command output exceeded 128 bytes")

    const pid = Number(await readFile(pidPath, "utf8"))
    for (let attempt = 0; attempt < 20 && alive(pid); attempt++) await Bun.sleep(250)
    expect(alive(pid)).toBeFalse()
  }
})

test("timeouts terminate descendants after the direct parent exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "halext-bridge-tree-test-"))
  paths.push(directory)
  const pidPath = join(directory, "descendant.pid")
  process.env.AFS_BIN = node
  process.env.AFS_CLI = node

  const started = performance.now()
  await expect(
    runAfsJson(
      [
        "-e",
        `const { spawn } = require("node:child_process"); const { writeFileSync } = require("node:fs"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: ["ignore", "inherit", "inherit"], detached: process.platform === "win32" }); writeFileSync(${JSON.stringify(pidPath)}, String(child.pid)); process.exit(0)`,
      ],
      { timeoutMs: process.platform === "win32" ? 10_000 : 200 },
    ),
  ).rejects.toThrow(process.platform === "win32" ? /descendant|cleanup/ : "AFS command timed out after 200ms")
  expect(performance.now() - started).toBeLessThan(process.platform === "win32" ? 8_000 : 2_000)

  const pid = Number(await readFile(pidPath, "utf8"))
  expect(pid).toBeGreaterThan(0)
  for (let attempt = 0; attempt < 20 && alive(pid); attempt++) await Bun.sleep(250)
  expect(alive(pid)).toBeFalse()
})

signalTest("successful parents cannot leave ignored-stdio descendants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "halext-bridge-orphan-test-"))
  paths.push(directory)
  const pidPath = join(directory, "descendant.pid")
  process.env.AFS_BIN = node
  process.env.AFS_CLI = node

  await expect(
    runAfsJson(
      [
        "-e",
        `const { spawn } = require("node:child_process"); const { writeFileSync } = require("node:fs"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" }); writeFileSync(${JSON.stringify(pidPath)}, String(child.pid)); console.log("{}"); process.exit(0)`,
      ],
      { timeoutMs: 2_000 },
    ),
  ).rejects.toThrow("descendant")

  const pid = Number(await readFile(pidPath, "utf8"))
  expect(pid).toBeGreaterThan(0)
  for (let attempt = 0; attempt < 20 && alive(pid); attempt++) await Bun.sleep(50)
  expect(alive(pid)).toBeFalse()
})

test.skipIf(process.platform !== "win32")(
  "Windows parent close drains ignored-stdio descendants before success",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "halext-bridge-windows-orphan-test-"))
    paths.push(directory)
    const pidPath = join(directory, "descendant.pid")
    process.env.AFS_BIN = node
    process.env.AFS_CLI = node

    await expect(
      runAfsJson(
        [
          "-e",
          `const { spawn } = require("node:child_process"); const { writeFileSync } = require("node:fs"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore", detached: true }); writeFileSync(${JSON.stringify(pidPath)}, String(child.pid)); console.log("{}"); process.exit(0)`,
        ],
        { timeoutMs: 10_000 },
      ),
    ).rejects.toThrow("descendant")

    const pid = Number(await readFile(pidPath, "utf8"))
    expect(pid).toBeGreaterThan(0)
    expect(alive(pid)).toBeFalse()
  },
)

test("client abort terminates the server-side AFS process tree", async () => {
  const directory = await fakeCli(
    `
const { spawn } = require("node:child_process")
const { writeFileSync } = require("node:fs")
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] })
writeFileSync(process.env.FAKE_PID_PATH, String(child.pid))
setInterval(() => {}, 1_000)
  `,
    { stayAlive: true },
  )
  const pidPath = join(directory, "request.pid")
  process.env.FAKE_PID_PATH = pidPath
  const server = Bun.serve({ hostname: DEFAULT_BRIDGE_HOST, port: 0, fetch: BridgeApp.fetch })

  try {
    const abort = new AbortController()
    const request = fetch(new URL("/api/summary", server.url), { signal: abort.signal }).catch(() => undefined)
    const pid = await waitForPid(pidPath)
    expect(pid).toBeDefined()

    abort.abort()
    await request
    for (let attempt = 0; attempt < 20 && alive(pid!); attempt += 1) await Bun.sleep(250)
    expect(alive(pid!)).toBeFalse()
  } finally {
    await server.stop(true)
  }
})

test("graceful shutdown terminates active AFS child trees", async () => {
  const directory = await fakeCli(
    `
const { spawn } = require("node:child_process")
const { writeFileSync } = require("node:fs")
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] })
writeFileSync(process.env.FAKE_PID_PATH, String(child.pid))
setInterval(() => {}, 1_000)
  `,
    { stayAlive: true },
  )
  const pidPath = join(directory, "shutdown.pid")
  process.env.FAKE_PID_PATH = pidPath
  const result = runAfsJson([], { timeoutMs: 10_000 }).then(
    () => undefined,
    (error) => error,
  )

  const pid = await waitForPid(pidPath)
  expect(pid).toBeDefined()

  const started = performance.now()
  await shutdownAfsProcesses()
  expect(performance.now() - started).toBeLessThan(3_000)
  expect(await result).toBeInstanceOf(Error)
  for (let attempt = 0; attempt < 20 && alive(pid!); attempt += 1) await Bun.sleep(250)
  expect(alive(pid!)).toBeFalse()
})

signalTest("termination kills a running child", async () => {
  const directory = await fakeCli(
    `
process.on("SIGTERM", () => {})
const { writeFileSync } = require("node:fs")
writeFileSync(process.env.FAKE_PID_PATH, String(process.pid))
setInterval(() => {}, 1_000)
  `,
    { stayAlive: true },
  )
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
