import { resolve } from "node:path"
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

if (import.meta.main) {
  Bun.serve({
    port: DEFAULT_PORT,
    idleTimeout: 30,
    fetch: BridgeApp.fetch,
  })
  console.log(`halext-bridge listening on http://127.0.0.1:${DEFAULT_PORT}`)
}
