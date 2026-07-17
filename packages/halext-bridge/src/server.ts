import { open, readdir, realpath, stat } from "node:fs/promises"
import { spawn, type ChildProcess } from "node:child_process"
import { extname, resolve, relative, sep } from "node:path"
import { Hono } from "hono"
import { cors } from "hono/cors"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { z } from "zod"
import { parseApprovals, parseHealth, parseMissions, parsePack, parseSummary } from "./index"

const DEFAULT_AFS_CLI = "afs"
const DEFAULT_PROJECT_PATH = process.env.HALEXT_BRIDGE_DEFAULT_PATH ?? resolve(import.meta.dir, "../../..")
const DEFAULT_PORT = Number(process.env.HALEXT_BRIDGE_PORT ?? "4319")
export const DEFAULT_BRIDGE_HOST = "127.0.0.1"
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const WINDOWS_NATIVE_TIMEOUT = 1_000
const WINDOWS_SHELL_TIMEOUT = 7_000
const WINDOWS_PROCESS_LIMIT = 1_024
const children = new Set<ChildProcess>()
const cleanupTasks = new Set<Promise<unknown>>()
const windowsCleanups = new WeakMap<ChildProcess, Promise<DescendantCleanup>>()

type DescendantCleanup = "clean" | "descendants" | "error"

const SummaryQuerySchema = z.object({
  path: z.string().optional(),
  task_limit: z.coerce.number().int().min(1).max(50).optional(),
  message_limit: z.coerce.number().int().min(0).max(20).optional(),
})

const PackQuerySchema = z.object({
  path: z.string().optional(),
  query: z.string().optional(),
  model: z.enum(["generic", "gemini", "claude", "codex"]).default("codex"),
  token_budget: z.coerce.number().int().min(256).max(64000).optional(),
  max_query_results: z.coerce.number().int().min(0).max(25).optional(),
  max_embedding_results: z.coerce.number().int().min(0).max(10).optional(),
  timeout_ms: z.coerce.number().int().min(1000).max(120000).optional(),
})

const MissionQuerySchema = z.object({
  path: z.string().optional(),
  status: z.enum(["active", "blocked", "done", "abandoned"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

const ApprovalQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
})

const FsListQuerySchema = z.object({
  root: z.string().optional(),
  path: z.string().optional(),
  depth: z.coerce.number().int().min(0).max(4).default(2),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  include_hidden: z
    .union([z.literal("1"), z.literal("true"), z.literal("yes")])
    .optional()
    .transform(Boolean),
})

const FsReadQuerySchema = z.object({
  root: z.string().optional(),
  path: z.string(),
  max_bytes: z.coerce.number().int().min(256).max(2_000_000).default(120_000),
})

class BridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message)
  }
}

function resolveProjectPath(input?: string) {
  const value = input?.trim()
  return value ? resolve(value) : DEFAULT_PROJECT_PATH
}

async function safePath(rootInput: string | undefined, pathInput: string | undefined) {
  const root = resolveProjectPath(rootInput)
  const raw = pathInput?.trim()
  const target = raw ? resolve(root, raw) : root
  const rootReal = await realpath(root).catch(() => {
    throw new BridgeError("Selected root does not exist", 404)
  })
  const info = await stat(target).catch(() => undefined)
  if (!info) throw new BridgeError("Requested path does not exist", 404)
  const targetReal = await realpath(target)
  const rel = relative(rootReal, targetReal)
  const outside = rel === ".." || rel.startsWith(`..${sep}`)
  if (outside) {
    throw new BridgeError("Requested path is outside the selected root", 400)
  }
  return { root: rootReal, target: targetReal, info }
}

function guessMime(path: string) {
  const ext = extname(path).toLowerCase()
  const map: Record<string, string> = {
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".js": "text/javascript",
    ".jsx": "text/javascript",
    ".json": "application/json",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".yml": "text/yaml",
    ".yaml": "text/yaml",
    ".toml": "text/plain",
    ".sh": "text/x-shellscript",
    ".py": "text/x-python",
    ".css": "text/css",
    ".html": "text/html",
    ".xml": "application/xml",
  }
  return map[ext] ?? "text/plain"
}

type TreeEntry = {
  name: string
  path: string
  type: "file" | "dir"
  size?: number
  mtime?: number
  children?: TreeEntry[]
}

async function listTree(
  path: string,
  cfg: { depth: number; limit: number; includeHidden: boolean },
  state: { count: number },
): Promise<TreeEntry[]> {
  if (state.count >= cfg.limit) return []
  const items = await readdir(path, { withFileTypes: true })
  const sorted = items
    .filter((item) => cfg.includeHidden || !item.name.startsWith("."))
    .toSorted((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  const out: TreeEntry[] = []
  for (const item of sorted) {
    if (state.count >= cfg.limit) break
    const child = resolve(path, item.name)
    const info = await stat(child).catch(() => undefined)
    if (!info) continue
    state.count += 1
    if (item.isDirectory()) {
      out.push({
        name: item.name,
        path: child,
        type: "dir",
        mtime: info.mtimeMs,
        children: cfg.depth > 0 ? await listTree(child, { ...cfg, depth: cfg.depth - 1 }, state) : [],
      })
      continue
    }
    out.push({
      name: item.name,
      path: child,
      type: "file",
      size: info.size,
      mtime: info.mtimeMs,
    })
  }
  return out
}

function allowedOrigin(input?: string) {
  if (!input) return undefined
  if (input.startsWith("http://localhost:")) return input
  if (input.startsWith("http://127.0.0.1:")) return input
  if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost") {
    return input
  }
  return undefined
}

function afsCli() {
  return process.env.AFS_BIN?.trim() || process.env.AFS_CLI?.trim() || DEFAULT_AFS_CLI
}

function command(cmd: string[]): [string, ...string[]] {
  const file = cmd[0]
  if (!file) throw new Error("Command is required")
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(file)) {
    throw new Error("Windows batch AFS launchers are unsupported; set AFS_BIN or AFS_CLI to a native executable")
  }
  return [file, ...cmd.slice(1)]
}

function trackedCleanup<T>(task: Promise<T>) {
  cleanupTasks.add(task)
  void task.finally(() => cleanupTasks.delete(task))
  return task
}

async function directWindowsChildren(parentPid: number) {
  if (process.arch === "x64") {
    try {
      return await new Promise<number[]>((resolve, reject) => {
        let settled = false
        const finish = (value: number[] | Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (value instanceof Error) reject(value)
          else resolve(value)
        }
        const timer = setTimeout(() => finish(new Error("Windows process snapshot timed out")), WINDOWS_NATIVE_TIMEOUT)
        void import("@vscode/windows-process-tree")
          .then((api) => {
            api.getAllProcesses((items) => {
              if (
                items.length === 0 ||
                items.length >= WINDOWS_PROCESS_LIMIT ||
                !items.some((item) => item.pid === process.pid)
              ) {
                finish(new Error("Windows process snapshot was empty or truncated"))
                return
              }
              finish(items.filter((item) => item.ppid === parentPid).map((item) => item.pid))
            })
          })
          .catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
      })
    } catch {}
  }

  // The Microsoft native addon currently ships x64 only. Keep ARM64 and
  // native-load failures fail-closed with a bounded system-CIM fallback.
  const script = `$ErrorActionPreference = 'Stop'
$self = [uint32]$PID
Get-CimInstance -Query "SELECT ProcessId,ParentProcessId FROM Win32_Process WHERE ProcessId = $self OR ParentProcessId = ${parentPid}" |
  ForEach-Object { [Console]::Out.WriteLine(('{0}:{1}' -f [uint32]$_.ProcessId, [uint32]$_.ParentProcessId)) }`
  return new Promise<number[]>((resolve, reject) => {
    let child: ChildProcess | undefined
    let settled = false
    let chunks: Buffer[] = []
    let size = 0
    const finish = (value: number[] | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child?.stdout?.destroy()
      child?.unref()
      if (value instanceof Error) reject(value)
      else resolve(value)
    }
    const launch = (file: "powershell.exe" | "pwsh.exe") => {
      if (settled) return
      chunks = []
      size = 0
      let current: ChildProcess
      try {
        current = spawn(
          file,
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
          { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
        )
        child = current
      } catch (error) {
        if (file === "pwsh.exe") launch("powershell.exe")
        else finish(error instanceof Error ? error : new Error(String(error)))
        return
      }
      current.stdout?.on("data", (chunk: Buffer) => {
        size += chunk.byteLength
        if (size > 64 * 1024) {
          try {
            current.kill("SIGKILL")
          } finally {
            finish(new Error("Windows process snapshot output exceeded its limit"))
          }
          return
        }
        chunks.push(chunk)
      })
      current.once("error", (error) => {
        if (child !== current || settled) return
        if (file === "pwsh.exe") launch("powershell.exe")
        else finish(error)
      })
      current.once("close", (code) => {
        if (child !== current || settled) return
        if (code !== 0) {
          if (file === "pwsh.exe") launch("powershell.exe")
          else finish(new Error("Windows process snapshot command failed"))
          return
        }
        const lines = Buffer.concat(chunks)
          .toString()
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        const rows = lines.map((line) => /^(\d+):(\d+)$/.exec(line))
        if (rows.some((row) => !row) || !current.pid || !rows.some((row) => Number(row?.[1]) === current.pid)) {
          finish(new Error("Windows process snapshot output was invalid"))
          return
        }
        finish(rows.filter((row) => Number(row?.[2]) === parentPid).map((row) => Number(row?.[1])))
      })
    }
    const timer = setTimeout(() => {
      try {
        child?.kill("SIGKILL")
      } finally {
        finish(new Error("Windows process snapshot command timed out"))
      }
    }, WINDOWS_SHELL_TIMEOUT)
    launch("pwsh.exe")
  })
}

function launchTaskkill(pid: number) {
  return new Promise<boolean>((resolve) => {
    let child: ChildProcess
    try {
      child = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      })
    } catch {
      resolve(false)
      return
    }
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } finally {
        child.unref()
        finish(false)
      }
    }, 1_000)
    child.once("close", (code) => finish(code === 0))
    child.once("error", () => finish(false))
  })
}

function cleanupWindowsDescendants(proc: ChildProcess, pid: number): Promise<DescendantCleanup> {
  const existing = windowsCleanups.get(proc)
  if (existing) return existing
  const task = (async (): Promise<DescendantCleanup> => {
    let targets: number[]
    try {
      targets = await directWindowsChildren(pid)
    } catch {
      return "error"
    }
    if (targets.length === 0) return "clean"
    const killed = await Promise.all(targets.map(launchTaskkill))
    return killed.every(Boolean) ? "descendants" : "error"
  })()
  const tracked = trackedCleanup(task)
  windowsCleanups.set(proc, tracked)
  return tracked
}

function terminateWindows(proc: ChildProcess, pid: number) {
  void trackedCleanup(launchTaskkill(pid))

  // A direct parent can exit while a descendant keeps an inherited pipe
  // open. taskkill cannot root a tree at that dead PID, so also discover
  // surviving descendants from their recorded ParentProcessId values. This
  // remains best-effort: a static snapshot cannot recover a deeper chain when
  // an intermediate parent already exited.
  const cleanup = cleanupWindowsDescendants(proc, pid)
  const timer = setTimeout(() => {
    try {
      proc.kill("SIGKILL")
    } catch {}
  }, 1_000)
  timer.unref()
  return cleanup
}

function cleanupUnixProcessGroup(pid: number): DescendantCleanup {
  try {
    process.kill(-pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return "clean"
    return "error"
  }

  try {
    process.kill(-pid, "SIGKILL")
    return "descendants"
  } catch {
    return "error"
  }
}

export function terminate(proc: ChildProcess) {
  const pid = proc.pid
  if (!pid) {
    proc.kill("SIGKILL")
    return Promise.resolve<DescendantCleanup>("error")
  }
  if (process.platform === "win32") {
    return terminateWindows(proc, pid)
  }
  try {
    process.kill(-pid, "SIGKILL")
    return Promise.resolve<DescendantCleanup>("descendants")
  } catch {
    proc.kill("SIGKILL")
    return Promise.resolve<DescendantCleanup>("error")
  }
}

function track(proc: ChildProcess) {
  children.add(proc)
  proc.once("close", () => children.delete(proc))
}

function closed(proc: ChildProcess, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      proc.off("close", done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    timer.unref()
    proc.once("close", done)
    if (!children.has(proc)) done()
  })
}

export async function shutdownAfsProcesses(timeoutMs = 2_000) {
  const active = [...children]
  const closing = active.map((proc) => closed(proc, timeoutMs))
  const cleanup = active.map(terminate)
  const tasks = [...closing, ...cleanup, ...cleanupTasks]
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    void Promise.allSettled(tasks).then(finish)
  })
}

export async function runAfsJson<T>(
  args: string[],
  options?: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal },
) {
  const timeoutMs = options?.timeoutMs ?? 60000
  const maxBytes = options?.maxBytes ?? MAX_OUTPUT_BYTES

  return new Promise<T>((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new BridgeError("AFS command was cancelled", 499))
      return
    }
    let proc: ChildProcess
    try {
      const cmd = command([afsCli(), ...args])
      proc = spawn(cmd[0], cmd.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
        env: process.env,
      })
      track(proc)
    } catch (error) {
      reject(new BridgeError(error instanceof Error ? error.message : "Failed to start AFS command", 502))
      return
    }
    if (!proc.stdout || !proc.stderr) {
      terminate(proc)
      reject(new BridgeError("AFS command output is unavailable", 502))
      return
    }

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    let settled = false
    let cancel: (() => void) | undefined

    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (cancel) options?.signal?.removeEventListener("abort", cancel)
      action()
    }
    const stop = (error: BridgeError) => {
      if (settled) return
      terminate(proc)
      proc.stdout?.destroy()
      proc.stderr?.destroy()
      proc.unref()
      finish(() => reject(error))
    }
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > maxBytes) {
        stop(new BridgeError(`AFS command output exceeded ${maxBytes} bytes`, 502))
        return
      }
      chunks.push(chunk)
    }
    const timer = setTimeout(() => stop(new BridgeError(`AFS command timed out after ${timeoutMs}ms`, 504)), timeoutMs)
    cancel = () => stop(new BridgeError("AFS command was cancelled", 499))

    proc.stdout.on("data", collect(stdout))
    proc.stderr.on("data", collect(stderr))
    proc.stdout.once("error", (error) => stop(new BridgeError(error.message, 502)))
    proc.stderr.once("error", (error) => stop(new BridgeError(error.message, 502)))
    proc.once("error", (error) => stop(new BridgeError(`Failed to start AFS command: ${error.message}`, 502)))
    proc.once("exit", () => {
      if (settled || process.platform !== "win32" || !proc.pid) return
      // A descendant can keep inherited pipes open after the direct process
      // exits, delaying `close`. Start discovery early so cleanup can drain it.
      void cleanupWindowsDescendants(proc, proc.pid)
    })
    proc.once("close", (code) => {
      if (settled) return
      const complete = async () => {
        const pid = proc.pid
        const cleanup = !pid
          ? "error"
          : process.platform === "win32"
            ? await cleanupWindowsDescendants(proc, pid)
            : cleanupUnixProcessGroup(pid)
        if (cleanup !== "clean") {
          const message =
            cleanup === "descendants"
              ? "AFS command left descendant processes"
              : "AFS command process-tree cleanup failed"
          finish(() => reject(new BridgeError(message, 502)))
          return
        }

        const out = Buffer.concat(stdout).toString()
        const err = Buffer.concat(stderr).toString()
        if (code !== 0) {
          finish(() => reject(new BridgeError(err.trim() || out.trim() || "AFS command failed", 502, err || out)))
          return
        }
        try {
          const value = JSON.parse(out) as T
          finish(() => resolve(value))
        } catch {
          finish(() => reject(new BridgeError("AFS returned non-JSON output", 502, out || err)))
        }
      }
      void complete()
    })
    options?.signal?.addEventListener("abort", cancel, { once: true })
    if (options?.signal?.aborted) cancel()
  })
}

function validate<T>(value: unknown, parse: (value: unknown) => T) {
  try {
    return parse(value)
  } catch (error) {
    const message =
      error instanceof Error ? error.message.replace(/^Bridge returned/, "AFS returned") : "AFS returned invalid output"
    throw new BridgeError(message, 502)
  }
}

export function approvalArgs(status?: z.infer<typeof ApprovalQuerySchema>["status"]) {
  return ["approvals", status === "pending" ? "list" : "history", "--json"]
}

function summaryArgs(path: string, taskLimit: number, messageLimit: number) {
  return [
    "session",
    "bootstrap",
    "--json",
    "--no-write-artifacts",
    "--path",
    path,
    "--task-limit",
    String(taskLimit),
    "--message-limit",
    String(messageLimit),
  ]
}

function packArgs(query: z.infer<typeof PackQuerySchema>) {
  const path = resolveProjectPath(query.path)
  const args = [
    "session",
    "pack",
    "--json",
    "--no-write-artifacts",
    "--path",
    path,
    "--model",
    query.model,
    "--max-query-results",
    String(query.max_query_results ?? 4),
    "--max-embedding-results",
    String(query.max_embedding_results ?? 0),
  ]

  if (query.token_budget) {
    args.push("--token-budget", String(query.token_budget))
  }
  if (query.query?.trim()) {
    args.push(query.query.trim())
  }
  return args
}

export const BridgeApp = new Hono()
  .use(
    cors({
      origin: allowedOrigin,
    }),
  )
  .onError((error, c) => {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Invalid bridge request",
          detail: error.flatten(),
        },
        400,
      )
    }
    if (error instanceof BridgeError) {
      return c.json(
        {
          error: error.message,
          detail: error.detail,
        },
        { status: error.status as ContentfulStatusCode },
      )
    }
    return c.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  })
  .get("/health", (c) =>
    c.json({
      ok: true as const,
      afs_cli: afsCli(),
      default_path: DEFAULT_PROJECT_PATH,
      cwd: process.cwd(),
    }),
  )
  .get("/api/summary", async (c) => {
    const query = SummaryQuerySchema.parse(c.req.query())
    const projectPath = resolveProjectPath(query.path)
    const summary = validate(
      await runAfsJson<unknown>(summaryArgs(projectPath, query.task_limit ?? 12, query.message_limit ?? 3), {
        timeoutMs: 10000,
        signal: c.req.raw.signal,
      }),
      parseSummary,
    )
    return c.json(summary)
  })
  .get("/api/session/pack", async (c) => {
    const query = PackQuerySchema.parse(c.req.query())
    const pack = validate(
      await runAfsJson<unknown>(packArgs(query), {
        timeoutMs: query.timeout_ms ?? 60000,
        signal: c.req.raw.signal,
      }),
      parsePack,
    )
    return c.json(pack)
  })
  .get("/api/missions", async (c) => {
    const query = MissionQuerySchema.parse(c.req.query())
    const args = [
      "list",
      "--json",
      "--path",
      resolveProjectPath(query.path),
      "--limit",
      String(query.limit ?? 20),
    ]
    if (query.status) args.push("--status", query.status)
    const options = { timeoutMs: 10000, signal: c.req.raw.signal }
    const missions = validate(
      await runAfsJson<unknown>(["missions", ...args], options).catch((error) => {
        if (error instanceof BridgeError && error.status !== 502) throw error
        return runAfsJson<unknown>(["mission", ...args], options)
      }),
      parseMissions,
    )
    return c.json(missions)
  })
  .get("/api/approvals", async (c) => {
    const query = ApprovalQuerySchema.parse(c.req.query())
    const approvals = validate(
      await runAfsJson<unknown>(approvalArgs(query.status), { timeoutMs: 10000, signal: c.req.raw.signal }),
      parseApprovals,
    )
    return c.json(query.status ? approvals.filter((item) => item.status === query.status) : approvals)
  })
  .get("/api/health", async (c) => {
    const health = validate(
      await runAfsJson<unknown>(["health", "status", "--json"], {
        timeoutMs: 20000,
        signal: c.req.raw.signal,
      }),
      parseHealth,
    )
    return c.json(health)
  })
  .get("/api/fs/list", async (c) => {
    const query = FsListQuerySchema.parse(c.req.query())
    const path = await safePath(query.root, query.path)
    if (!path.info.isDirectory()) throw new BridgeError("Requested path is not a directory", 400)
    const entries = await listTree(
      path.target,
      {
        depth: query.depth,
        limit: query.limit,
        includeHidden: query.include_hidden,
      },
      { count: 0 },
    )
    return c.json({
      root: path.root,
      target: path.target,
      entries,
    })
  })
  .get("/api/fs/read", async (c) => {
    const query = FsReadQuerySchema.parse(c.req.query())
    const path = await safePath(query.root, query.path)
    if (!path.info.isFile()) throw new BridgeError("Requested path is not a file", 400)
    const file = await open(path.target, "r")
    const raw = Buffer.alloc(Math.min(path.info.size, query.max_bytes + 1))
    const read = await file.read(raw, 0, raw.byteLength, 0).finally(() => file.close())
    const body = raw.subarray(0, Math.min(read.bytesRead, query.max_bytes))
    return c.json({
      root: path.root,
      path: path.target,
      mime: guessMime(path.target),
      truncated: path.info.size > query.max_bytes,
      size: path.info.size,
      content: body.toString("utf8"),
    })
  })

if (import.meta.main) {
  const server = Bun.serve({
    hostname: DEFAULT_BRIDGE_HOST,
    port: DEFAULT_PORT,
    idleTimeout: 30,
    fetch: BridgeApp.fetch,
  })
  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    await Promise.allSettled([server.stop(true), shutdownAfsProcesses()])
    process.exit(0)
  }
  process.once("SIGINT", () => void shutdown())
  process.once("SIGTERM", () => void shutdown())
  console.log(`halext-bridge listening on http://${DEFAULT_BRIDGE_HOST}:${DEFAULT_PORT}`)
}
