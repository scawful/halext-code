import { spawn, type ChildProcess } from "child_process"

export type RunOptions = {
  timeout: number
  limit: number
}

type WindowsDescendantCleanup = "clean" | "descendants" | "error"

function cleanupWindowsDescendants(pid: number): Promise<WindowsDescendantCleanup> {
  const script = `
$ErrorActionPreference = 'Stop'
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
if ($targets.Count -eq 0) { exit 0 }
foreach ($targetPid in $targets) {
  & taskkill.exe /PID $targetPid /T /F *> $null
}
exit 42
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
    const finish = (result: WindowsDescendantCleanup) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      cleaner.kill("SIGKILL")
      finish("error")
    }, 3_000)
    timer.unref()
    cleaner.once("error", () => finish("error"))
    cleaner.once("close", (code) => finish(code === 0 ? "clean" : code === 42 ? "descendants" : "error"))
  })
}

function terminateWindows(proc: ChildProcess, pid: number, cleanupDescendants: () => Promise<WindowsDescendantCleanup>) {
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

function terminate(proc: ChildProcess, cleanupWindows?: () => Promise<WindowsDescendantCleanup>) {
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
    let windowsCleanup: Promise<WindowsDescendantCleanup> | undefined
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
      if (process.platform !== "win32" || !proc.pid) {
        finish(value)
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
