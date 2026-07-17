import { isAbsolute, relative, resolve } from "path"

export type Project = {
  root: string
  scope: string
  version: 1 | 2
}

const MOUNTS = new Set([
  "history",
  "memory",
  "scratchpad",
  "knowledge",
  "tools",
  "human",
  // Compatibility-only mount names for contexts created before layout v2.
  "hivemind",
  "items",
  "global",
  "monorepo",
])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Parse the fail-closed result of `afs projects current --json`. */
export function project(value: unknown): Project | undefined {
  if (!record(value)) return
  if (typeof value.context_root !== "string" || !isAbsolute(value.context_root)) return
  if (value.layout_version === 1 && value.registered === false && value.scope_id === "common") {
    return { root: value.context_root, scope: value.scope_id, version: 1 }
  }
  if (value.layout_version !== 2 || value.registered !== true) return
  if (typeof value.scope_id !== "string" || !value.scope_id.startsWith("project:")) return
  if (!record(value.project) || typeof value.project.project_id !== "string" || !value.project.project_id) return
  if (value.scope_id !== `project:${value.project.project_id}`) return
  return { root: value.context_root, scope: value.scope_id, version: 2 }
}

function rooted(root: string, parts: string[]) {
  const target = resolve(root, ...parts)
  const child = relative(root, target)
  if (child === "" || (!child.startsWith("..") && !isAbsolute(child))) return target
  return root
}

/** Normalize familiar context-relative paths against the central context root. */
export function path(current: Project, value: unknown) {
  if (typeof value !== "string") return value
  const input = value.trim()
  if (!input || isAbsolute(input)) return value
  if (current.version === 2) {
    if (input === ".context") return value
    if (/^\.context[\\/]/.test(input)) {
      const parts = input.slice(9).split(/[\\/]/)
      if (parts.some((part) => !part || part === "." || part === "..")) return value
      return parts.join("/")
    }
    return value
  }
  if (input === ".context") return current.root
  if (/^\.context[\\/]/.test(input)) return rooted(current.root, input.slice(9).split(/[\\/]/))
  const head = input.split(/[\\/]/, 1)[0] ?? ""
  if (MOUNTS.has(head)) return rooted(current.root, input.split(/[\\/]/))
  return value
}
