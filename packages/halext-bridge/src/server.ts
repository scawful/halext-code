import { extname, resolve, relative, sep } from "node:path"
import { open, readdir, realpath, stat } from "node:fs/promises"
import { Hono } from "hono"
import { cors } from "hono/cors"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { z } from "zod"
import type { AfsBootstrapSummary, AfsContextPack } from "./index"

const DEFAULT_AFS_CLI = process.env.AFS_CLI ?? "/Users/scawful/src/lab/afs/scripts/afs"
const DEFAULT_PROJECT_PATH = process.env.HALEXT_BRIDGE_DEFAULT_PATH ?? resolve(import.meta.dir, "../../..")
const DEFAULT_PORT = Number(process.env.HALEXT_BRIDGE_PORT ?? "4319")

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

async function runAfsJson<T>(args: string[], options?: { timeoutMs?: number }) {
  const proc = Bun.spawn({
    cmd: [DEFAULT_AFS_CLI, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  const stdoutPromise = new Response(proc.stdout).text()
  const stderrPromise = new Response(proc.stderr).text()
  const timeoutMs = options?.timeoutMs ?? 60000

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      proc.exited,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          try {
            proc.kill()
          } catch {}
          reject(new BridgeError(`AFS command timed out after ${timeoutMs}ms`, 504))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }

  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, stdoutPromise, stderrPromise])

  if (exitCode !== 0) {
    throw new BridgeError(stderr.trim() || stdout.trim() || "AFS command failed", 502, stderr || stdout)
  }

  try {
    return JSON.parse(stdout) as T
  } catch {
    throw new BridgeError("AFS returned non-JSON output", 502, stdout || stderr)
  }
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
      afs_cli: DEFAULT_AFS_CLI,
      default_path: DEFAULT_PROJECT_PATH,
      cwd: process.cwd(),
    }),
  )
  .get("/api/summary", async (c) => {
    const query = SummaryQuerySchema.parse(c.req.query())
    const projectPath = resolveProjectPath(query.path)
    const summary = await runAfsJson<AfsBootstrapSummary>(summaryArgs(projectPath, query.task_limit ?? 12, query.message_limit ?? 3), {
      timeoutMs: 10000,
    })
    return c.json(summary)
  })
  .get("/api/session/pack", async (c) => {
    const query = PackQuerySchema.parse(c.req.query())
    const pack = await runAfsJson<AfsContextPack>(packArgs(query), {
      timeoutMs: query.timeout_ms ?? 60000,
    })
    return c.json(pack)
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
  Bun.serve({
    port: DEFAULT_PORT,
    idleTimeout: 30,
    fetch: BridgeApp.fetch,
  })
  console.log(`halext-bridge listening on http://127.0.0.1:${DEFAULT_PORT}`)
}
