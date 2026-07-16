import { spawn, type ChildProcess } from "node:child_process"

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
  const data = Buffer.from(JSON.stringify(cmd)).toString("base64")
  const script = `
$ErrorActionPreference = 'Stop'
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))
$parts = @(ConvertFrom-Json -InputObject $json)
$exe = [string]$parts[0]
$rest = @()
if ($parts.Count -gt 1) {
  $rest = @($parts[1..($parts.Count - 1)] | ForEach-Object { [string]$_ })
}
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
  // Toolhelp is a local kernel snapshot; unlike WMI/PowerShell it adds no
  // multi-second helper startup to every successful sidebar poll.
  const { dlopen, ptr } = await import("bun:ffi")
  const pointerSize = process.arch === "ia32" ? 4 : 8
  const entrySize = pointerSize === 8 ? 568 : 556
  const parentOffset = pointerSize === 8 ? 32 : 24
  const kernel32 = dlopen("kernel32.dll", {
    CreateToolhelp32Snapshot: { args: ["u32", "u32"], returns: "ptr" },
    Process32FirstW: { args: ["ptr", "ptr"], returns: "i32" },
    Process32NextW: { args: ["ptr", "ptr"], returns: "i32" },
    CloseHandle: { args: ["ptr"], returns: "i32" },
  } as const)
  const entry = new Uint8Array(entrySize)
  const view = new DataView(entry.buffer, entry.byteOffset, entry.byteLength)
  view.setUint32(0, entrySize, true)
  const snapshot = kernel32.symbols.CreateToolhelp32Snapshot(0x00000002, 0)
  if (!snapshot) {
    kernel32.close()
    throw new Error("CreateToolhelp32Snapshot failed")
  }
  try {
    let more = kernel32.symbols.Process32FirstW(snapshot, ptr(entry))
    if (!more) throw new Error("Process32FirstW failed")
    const children: number[] = []
    while (more) {
      if (view.getUint32(parentOffset, true) === parentPid) children.push(view.getUint32(8, true))
      more = kernel32.symbols.Process32NextW(snapshot, ptr(entry))
    }
    return children
  } finally {
    kernel32.symbols.CloseHandle(snapshot)
    kernel32.close()
  }
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
    const finish = (launched: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.unref()
      resolve(launched)
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      finish(false)
    }, 1_000)
    child.once("spawn", () => finish(true))
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
  const launched = await Promise.all(targets.map(launchTaskkill))
  return launched.every(Boolean) ? "descendants" : "error"
}

function windows(proc: ChildProcess, pid: number, cleanupDescendants: () => Promise<DescendantCleanup>) {
  try {
    const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
    child.once("error", () => {})
    child.unref()
  } catch {}

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
