import { spawn, type ChildProcess } from "node:child_process"

const WINDOWS_NATIVE_TIMEOUT = 1_000
const WINDOWS_SHELL_TIMEOUT = 7_000
const WINDOWS_PROCESS_LIMIT = 1_024

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
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(file)) return [file, ...cmd.slice(1)]
  // Batch files need a Windows command host. Encode argv before PowerShell
  // sees it so paths and user-supplied values never become shell syntax.
  const data = Buffer.from(JSON.stringify({ exe: file, args: cmd.slice(1) })).toString("base64")
  const script = `
$ErrorActionPreference = 'Stop'
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))
$payload = ConvertFrom-Json -InputObject $json
$exe = [string]$payload.exe
$rest = @($payload.args | ForEach-Object { [string]$_ })
& $exe @rest
exit $LASTEXITCODE
`
  return [
    "powershell.exe",
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]
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

async function cleanupWindowsDescendants(pid: number): Promise<DescendantCleanup> {
  let targets: number[]
  try {
    targets = await directWindowsChildren(pid)
  } catch {
    return "error"
  }
  if (targets.length === 0) return "clean"
  const killed = await Promise.all(targets.map(launchTaskkill))
  return killed.every(Boolean) ? "descendants" : "error"
}

function windows(proc: ChildProcess, pid: number, cleanupDescendants: () => Promise<DescendantCleanup>) {
  void launchTaskkill(pid)

  // A parent can exit while a descendant keeps an inherited pipe open. In
  // that case taskkill cannot root the tree at the dead PID, so discover the
  // surviving descendants from their recorded ParentProcessId values. This
  // remains best-effort if an intermediate process exits before the snapshot.
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
