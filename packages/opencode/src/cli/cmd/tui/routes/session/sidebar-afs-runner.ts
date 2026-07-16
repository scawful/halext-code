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

function windows(proc: ChildProcess, pid: number) {
  try {
    const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
    child.unref()
  } catch {}

  // A parent can exit while a descendant keeps an inherited pipe open. In
  // that case taskkill cannot root the tree at the dead PID, so discover the
  // surviving descendants from their recorded ParentProcessId values.
  try {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$rootPid = [uint32]${pid}
$all = @(Get-CimInstance Win32_Process)
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
foreach ($targetPid in $targets) {
  & taskkill.exe /PID $targetPid /T /F *> $null
}
`
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { stdio: "ignore", windowsHide: true },
    )
    child.unref()
  } catch {}

  const timer = setTimeout(() => {
    try {
      proc.kill("SIGKILL")
    } catch {}
  }, 1_000)
  timer.unref()
}

function terminate(proc: ChildProcess) {
  const pid = proc.pid
  if (!pid) {
    proc.kill("SIGKILL")
    return
  }
  if (process.platform === "win32") {
    windows(proc, pid)
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    proc.kill("SIGKILL")
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

    const finish = (value?: Result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal.removeEventListener("abort", stop)
      resolve(value)
    }
    const stop = () => {
      if (settled) return
      terminate(proc)
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
    proc.once("close", (code) => {
      finish({
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      })
    })
    options.signal.addEventListener("abort", stop, { once: true })
    if (options.signal.aborted) stop()
  })
}
