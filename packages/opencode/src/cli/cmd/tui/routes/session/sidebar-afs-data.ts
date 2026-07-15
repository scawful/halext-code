import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export type Mission = {
  mission_id: string
  title: string
  status: "active" | "blocked"
  next_steps: string[]
}

export const BYTES = 256_000
export const COUNT = 99

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function context(dir: string) {
  const start = resolve(dir)
  const walk = (root: string): string | undefined => {
    if (existsSync(join(root, ".context"))) return root
    const parent = dirname(root)
    if (parent === root) return
    return walk(parent)
  }
  return walk(start)
}

export function missions(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Mission => {
      if (!record(item)) return false
      if (typeof item.mission_id !== "string" || item.mission_id.length === 0) return false
      if (typeof item.title !== "string" || item.title.length === 0) return false
      if (item.status !== "active" && item.status !== "blocked") return false
      return Array.isArray(item.next_steps) && item.next_steps.every((step) => typeof step === "string")
    })
    .slice(0, 3)
}

export function approvals(value: unknown) {
  if (!Array.isArray(value)) return { count: 0, capped: false }
  const count = value.filter((item) => {
    if (!record(item)) return false
    if (typeof item.agent !== "string" || item.agent.length === 0) return false
    if (typeof item.action !== "string" || item.action.length === 0) return false
    return item.status === "pending"
  }).length
  return {
    count: Math.min(count, COUNT),
    capped: count > COUNT,
  }
}
