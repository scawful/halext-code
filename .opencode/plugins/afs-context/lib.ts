import { spawn, type ChildProcess } from "child_process"
import { randomUUID } from "crypto"
import { readFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

export type RunOptions = {
  timeout: number
  limit: number
}

type DescendantCleanup = "clean" | "descendants" | "error"

function cleanupWindowsDescendants(pid: number): Promise<DescendantCleanup> {
  const resultPath = join(tmpdir(), `hcode-afs-cleanup-${process.pid}-${randomUUID()}.txt`)
  const encodedResultPath = Buffer.from(resultPath).toString("base64")
  const script = `
$ErrorActionPreference = 'Stop'
$resultPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedResultPath}'))
$rootPid = [uint32]${pid}
$all = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)
$ErrorActionPreference = 'SilentlyContinue'
$pending = @($rootPid)
$targets = @()
while ($pending.Count -gt 0) {
  $next = @()
  foreach ($parentPid in $pending) {
    $next += @($all | Where-Object { [uint32]$_.ParentProcessId -eq [uint32]$parentPid } | ForEach-Object { [uint32]$_.ProcessId })
  }
  $next = @($next | Where-Object { $targets -notcontains $_ } | Sort-Object -Unique)
  $targets += $next
  $pending = $next
}
if ($targets.Count -eq 0) {
  [IO.File]::WriteAllText($resultPath, 'clean', [Text.Encoding]::ASCII)
  exit 0
}
foreach ($targetPid in $targets) {
  & taskkill.exe /PID $targetPid /T /F *> $null
}
[IO.File]::WriteAllText($resultPath, 'descendants', [Text.Encoding]::ASCII)
exit 0
`

  return new Promise((resolve) => {
    let cleaner: ChildProcess
    try {
      cleaner = spawn(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { stdio: "ignore", windowsHide: true },
      )
    } catch {
      resolve("error")
      return
    }

    let settled = false
    let poll: ReturnType<typeof setInterval> | undefined
    const finish = (result: DescendantCleanup) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (poll) clearInterval(poll)
      try {
        unlinkSync(resultPath)
      } catch {}
      cleaner.unref()
      resolve(result)
    }
    const timer = setTimeout(() => {
      cleaner.kill("SIGKILL")
      finish("error")
    }, 7_000)
    timer.unref()
    poll = setInterval(() => {
      let result = ""
      try {
        result = readFileSync(resultPath, "ascii").trim()
      } catch {}
      if (result === "descendants") finish("descendants")
      else if (result === "clean") finish("clean")
    }, 25)
    poll.unref()
    cleaner.once("error", () => finish("error"))
  })
}

function terminateWindows(proc: ChildProcess, pid: number, cleanupDescendants: () => Promise<DescendantCleanup>) {
  // taskkill handles the ordinary case while the parent is still alive. A direct
  // child can exit before our timeout while one of its children keeps inherited
  // stdout open, though; taskkill cannot root a tree at that dead PID. Snapshot
  // Win32_Process as a fallback and kill any surviving descendants by their own
  // PIDs, preserving tree cleanup for that orphaned-parent case.
  try {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
    killer.unref()
  } catch {}

  void cleanupDescendants()

  const fallback = setTimeout(() => proc.kill("SIGKILL"), 1_000)
  fallback.unref()
}

function terminate(proc: ChildProcess, cleanupWindows?: () => Promise<DescendantCleanup>) {
  const pid = proc.pid
  if (!pid) {
    proc.kill("SIGKILL")
    return
  }

  if (process.platform === "win32") {
    terminateWindows(proc, pid, cleanupWindows ?? (() => cleanupWindowsDescendants(pid)))
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

/** Run a bounded, argument-vector command. Returns null on timeout, overflow, or failure. */
export function run(cmd: string[], opts: RunOptions): Promise<string | null> {
  if (!cmd[0]) return Promise.resolve(null)

  return new Promise((resolve) => {
    let proc: ChildProcess
    try {
      proc = spawn(cmd[0], cmd.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      })
    } catch {
      resolve(null)
      return
    }
    if (!proc.stdout || !proc.stderr) {
      proc.kill()
      resolve(null)
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    let failed = false
    let settled = false
    let windowsCleanup: Promise<DescendantCleanup> | undefined
    const cleanupWindows = () => (windowsCleanup ??= cleanupWindowsDescendants(proc.pid!))

    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const stop = () => {
      if (failed) return
      failed = true
      terminate(proc, cleanupWindows)
      proc.stdout?.destroy()
      proc.stderr?.destroy()
      proc.unref()
      finish(null)
    }
    const timer = setTimeout(stop, opts.timeout)

    proc.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > opts.limit) {
        stop()
        return
      }
      chunks.push(chunk)
    })
    proc.stderr.resume()
    proc.once("error", () => {
      failed = true
      finish(null)
    })
    proc.once("close", (code) => {
      if (settled) return
      const value = !failed && code === 0 ? Buffer.concat(chunks).toString().trim() : null
      if (!proc.pid) {
        finish(value)
        return
      }
      if (process.platform !== "win32") {
        // A daemonized child can close or ignore the captured streams and let
        // its direct parent exit cleanly. Drain the detached process group
        // before reporting success so it cannot outlive this bounded call.
        finish(cleanupUnixProcessGroup(proc.pid) === "clean" ? value : null)
        return
      }

      // Bun's Windows child-process shim can emit close after the direct
      // process exits even while a descendant remains alive. Check and drain
      // that orphaned tree before reporting success; a discovered descendant
      // makes the bounded command fail closed.
      void cleanupWindows().then((result) => finish(result === "clean" ? value : null))
    })
  })
}
