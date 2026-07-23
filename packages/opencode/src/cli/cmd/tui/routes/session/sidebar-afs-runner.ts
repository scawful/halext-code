import { spawn, type ChildProcess } from "node:child_process"

const WINDOWS_NATIVE_TIMEOUT = 1_000
const WINDOWS_SHELL_TIMEOUT = 7_000
const WINDOWS_PROCESS_LIMIT = 1_024
const WINDOWS_CLEANUP_TIMEOUT = 3_000
export const WINDOWS_TASKKILL_BATCH = 128
export const WINDOWS_TASKKILL_CONCURRENCY = 4

export type Result = {
  code: number
  stdout: Buffer
  stderr: Buffer
}

type Options = {
  signal: AbortSignal
  timeout: number
  limit: number
}

type DescendantCleanup = "clean" | "descendants" | "error"

function command(cmd: string[]): [string, ...string[]] {
  const file = cmd[0]
  if (!file) throw new Error("Command is required")
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(file)) {
    throw new Error("Windows batch AFS launchers are unsupported; set AFS_BIN or AFS_CLI to a native executable")
  }
  return [file, ...cmd.slice(1)]
}

export function windowsDescendants(items: ReadonlyArray<{ pid: number; ppid: number }>, parentPid: number) {
  const byParent = new Map<number, number[]>()
  for (const item of items) {
    const children = byParent.get(item.ppid)
    if (children) children.push(item.pid)
    else byParent.set(item.ppid, [item.pid])
  }
  const seen = new Set([parentPid])
  const pending = [parentPid]
  const targets: number[] = []
  for (let index = 0; index < pending.length; index += 1) {
    for (const pid of byParent.get(pending[index]!) ?? []) {
      if (seen.has(pid)) continue
      seen.add(pid)
      pending.push(pid)
      targets.push(pid)
    }
  }
  return targets
}

async function windowsChildren(parentPid: number) {
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
              finish(windowsDescendants(items, parentPid))
            })
          })
          .catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
      })
    } catch {}
  }

  // The Microsoft native addon currently ships x64 only. Keep ARM64 and
  // native-load failures fail-closed with a bounded system-CIM fallback.
  const script = `$ErrorActionPreference = 'Stop'
Get-CimInstance -Query "SELECT ProcessId,ParentProcessId FROM Win32_Process" |
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
        if (rows.length >= WINDOWS_PROCESS_LIMIT) {
          finish(new Error("Windows process snapshot was truncated"))
          return
        }
        finish(
          windowsDescendants(
            rows.map((row) => ({ pid: Number(row?.[1]), ppid: Number(row?.[2]) })),
            parentPid,
          ),
        )
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

function launchTaskkill(pids: number[], tree = false) {
  return new Promise<boolean>((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(
        "taskkill.exe",
        [...pids.flatMap((pid) => ["/PID", String(pid)]), ...(tree ? ["/T"] : []), "/F"],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      )
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

async function cleanupWindowsDescendants(pid: number): Promise<DescendantCleanup> {
  let targets: number[]
  try {
    targets = await windowsChildren(pid)
  } catch {
    return "error"
  }
  if (targets.length === 0) return "clean"
  return cleanupWindowsTargets(targets)
}

export async function cleanupWindowsTargets(
  targets: number[],
  kill: (pids: number[]) => Promise<boolean> = launchTaskkill,
): Promise<DescendantCleanup> {
  if (targets.length === 0) return "clean"
  if (
    targets.length >= WINDOWS_PROCESS_LIMIT ||
    targets.some((pid) => !Number.isSafeInteger(pid) || pid <= 0) ||
    new Set(targets).size !== targets.length
  )
    return "error"

  const batches = Array.from({ length: Math.ceil(targets.length / WINDOWS_TASKKILL_BATCH) }, (_, index) =>
    targets.slice(index * WINDOWS_TASKKILL_BATCH, (index + 1) * WINDOWS_TASKKILL_BATCH),
  )
  let next = 0
  let killed = true
  const work = async () => {
    while (next < batches.length) {
      const batch = batches[next++]
      if (!batch) return
      try {
        killed = (await kill(batch)) && killed
      } catch {
        killed = false
      }
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), WINDOWS_CLEANUP_TIMEOUT)
  })
  const complete = Promise.all(
    Array.from({ length: Math.min(WINDOWS_TASKKILL_CONCURRENCY, batches.length) }, work),
  ).then(() => true as const)
  const finished = await Promise.race([complete, deadline])
  if (timer) clearTimeout(timer)
  return finished && killed && next === batches.length ? "descendants" : "error"
}

function windows(proc: ChildProcess, pid: number, cleanupDescendants: () => Promise<DescendantCleanup>) {
  void launchTaskkill([pid], true)

  // A parent can exit while a descendant keeps an inherited pipe open. In
  // that case taskkill cannot root the tree at the dead PID, so discover every
  // descendant in a bounded full snapshot. This remains best-effort if an
  // intermediate process exits before the snapshot and breaks the ancestry.
  void cleanupDescendants()

  const timer = setTimeout(() => {
    try {
      proc.kill("SIGKILL")
    } catch {}
  }, 1_000)
  timer.unref()
}

function terminate(proc: ChildProcess, cleanupWindows?: () => Promise<DescendantCleanup>) {
  const pid = proc.pid
  if (!pid) {
    proc.kill("SIGKILL")
    return
  }
  if (process.platform === "win32") {
    windows(proc, pid, cleanupWindows ?? (() => cleanupWindowsDescendants(pid)))
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    proc.kill("SIGKILL")
  }
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

/** Run one CLI command with a wall-clock timeout and a combined output cap. */
export function run(cmd: string[], options: Options): Promise<Result | undefined> {
  if (!cmd[0] || options.signal.aborted) return Promise.resolve(undefined)

  return new Promise((resolve) => {
    let proc: ChildProcess
    try {
      const argv = command(cmd)
      proc = spawn(argv[0], argv.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      })
    } catch {
      resolve(undefined)
      return
    }
    if (!proc.stdout || !proc.stderr) {
      terminate(proc)
      resolve(undefined)
      return
    }

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    let settled = false
    let windowsCleanup: Promise<DescendantCleanup> | undefined
    const cleanupWindows = () => (windowsCleanup ??= cleanupWindowsDescendants(proc.pid!))

    const finish = (value?: Result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal.removeEventListener("abort", stop)
      resolve(value)
    }
    const stop = () => {
      if (settled) return
      terminate(proc, cleanupWindows)
      proc.stdout?.destroy()
      proc.stderr?.destroy()
      proc.unref()
      finish()
    }
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > options.limit) {
        stop()
        return
      }
      chunks.push(chunk)
    }
    const timer = setTimeout(stop, options.timeout)

    proc.stdout.on("data", collect(stdout))
    proc.stderr.on("data", collect(stderr))
    proc.stdout.once("error", stop)
    proc.stderr.once("error", stop)
    proc.once("error", stop)
    proc.once("exit", () => {
      if (settled || process.platform !== "win32" || !proc.pid) return
      // A descendant can keep inherited pipes open after the direct process
      // exits, delaying `close`. Start discovery early so cleanup can drain it.
      void cleanupWindows()
    })
    proc.once("close", (code) => {
      if (settled) return
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }
      if (!proc.pid) {
        finish()
        return
      }
      if (process.platform !== "win32") {
        finish(cleanupUnixProcessGroup(proc.pid) === "clean" ? result : undefined)
        return
      }
      void cleanupWindows().then((cleanup) => finish(cleanup === "clean" ? result : undefined))
    })
    options.signal.addEventListener("abort", stop, { once: true })
    if (options.signal.aborted) stop()
  })
}
