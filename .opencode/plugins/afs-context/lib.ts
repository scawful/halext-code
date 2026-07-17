import { spawn, type ChildProcess } from "child_process"

const WINDOWS_NATIVE_TIMEOUT = 1_000
const WINDOWS_SHELL_TIMEOUT = 7_000
const WINDOWS_PROCESS_LIMIT = 1_024
export const WINDOWS_CHILD_LIMIT = 8

export type RunOptions = {
  timeout: number
  limit: number
}

type DescendantCleanup = "clean" | "descendants" | "error"

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

  // The native addon currently ships x64 only. Keep ARM64 and native-load
  // failures fail-closed with a bounded system-CIM fallback.
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

async function cleanupWindowsDescendants(pid: number): Promise<DescendantCleanup> {
  let targets: number[]
  try {
    targets = await directWindowsChildren(pid)
  } catch {
    return "error"
  }
  if (targets.length === 0) return "clean"
  return cleanupWindowsTargets(targets)
}

export async function cleanupWindowsTargets(
  targets: number[],
  kill: (pid: number) => Promise<boolean> = launchTaskkill,
): Promise<DescendantCleanup> {
  if (targets.length === 0) return "clean"

  let killed = true
  for (const pid of targets.slice(0, WINDOWS_CHILD_LIMIT)) {
    const ok = await kill(pid)
    killed = ok && killed
  }
  if (targets.length > WINDOWS_CHILD_LIMIT) return "error"
  return killed ? "descendants" : "error"
}

function terminateWindows(proc: ChildProcess, pid: number, cleanupDescendants: () => Promise<DescendantCleanup>) {
  // taskkill handles the ordinary case while the parent is still alive. A direct
  // child can exit before our timeout while one of its children keeps inherited
  // stdout open, though; taskkill cannot root a tree at that dead PID. Query
  // surviving direct children and kill each remaining tree by its own PID.
  void launchTaskkill(pid)

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
    proc.once("exit", () => {
      if (settled || process.platform !== "win32" || !proc.pid) return
      // A descendant can keep inherited pipes open after the direct process
      // exits, which delays `close`. Start discovery at `exit` so cleanup can
      // drain that tree and allow the captured streams to close promptly.
      void cleanupWindows()
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
