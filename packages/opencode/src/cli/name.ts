import path from "path"

export namespace App {
  const fallback = "opencode"
  const skip = new Set(["", "bun", "bunx", "node", "tsx", "ts-node", "index"])

  function env() {
    const value = process.env["OPENCODE_CLI_NAME"]?.trim()
    if (!value) return
    return value
  }

  function argv() {
    const value = process.argv[1]?.trim()
    if (!value) return
    const base = path.basename(value).replace(/\.[cm]?[jt]sx?$/, "")
    if (skip.has(base)) return
    return base
  }

  export function name() {
    return env() ?? argv() ?? fallback
  }

  export function cmd(value: string) {
    return `${name()} ${value}`
  }

  export function launch(root?: string) {
    if (name() === "hcode" && root) return path.join(root, "scripts", "hcode")
    return name()
  }
}
