import { isAbsolute } from "node:path"

export type Mission = {
  mission_id: string
  title: string
  status: "active" | "blocked"
  next_steps: string[]
}

type Approval = {
  agent: string
  action: string
  status: string
}

export type Project = {
  root: string
  scope: string
}

export const BYTES = 256_000
export const COUNT = 99

export type Snapshot = {
  dir: string
  missions: Mission[]
  approvals: { count: number; capped: boolean }
  missionSeen: boolean
  approvalSeen: boolean
  stale: boolean
  unavailable: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function mission(value: unknown): value is Mission {
  if (!record(value)) return false
  if (typeof value.mission_id !== "string" || value.mission_id.length === 0) return false
  if (typeof value.title !== "string" || value.title.length === 0) return false
  if (value.status !== "active" && value.status !== "blocked") return false
  return Array.isArray(value.next_steps) && value.next_steps.every((step) => typeof step === "string")
}

function approval(value: unknown): value is Approval {
  if (!record(value)) return false
  if (typeof value.agent !== "string" || value.agent.length === 0) return false
  if (typeof value.action !== "string" || value.action.length === 0) return false
  return typeof value.status === "string" && value.status.length > 0
}

export function project(value: unknown): Project | undefined {
  if (!record(value)) return
  if (typeof value.context_root !== "string" || !isAbsolute(value.context_root)) return
  if (value.layout_version === 1 && value.registered === false && value.scope_id === "common") {
    return { root: value.context_root, scope: value.scope_id }
  }
  if (value.layout_version !== 2 || value.registered !== true) return
  if (typeof value.scope_id !== "string" || !value.scope_id.startsWith("project:")) return
  if (!record(value.project) || typeof value.project.project_id !== "string" || !value.project.project_id) return
  if (value.scope_id !== `project:${value.project.project_id}`) return
  return { root: value.context_root, scope: value.scope_id }
}

export function missions(value: unknown) {
  if (!Array.isArray(value) || !value.every(mission)) return
  return value
    .toSorted((left, right) => Number(right.status === "blocked") - Number(left.status === "blocked"))
    .slice(0, 3)
}

export function approvals(value: unknown) {
  if (!Array.isArray(value) || !value.every(approval)) return
  const count = value.filter((item) => item.status === "pending").length
  return {
    count: Math.min(count, COUNT),
    capped: count > COUNT,
  }
}

export function snapshot(
  dir: string,
  previous: Snapshot | undefined,
  update: { missions?: Mission[]; approvals?: { count: number; capped: boolean } },
): Snapshot {
  const current =
    previous?.dir === dir
      ? previous
      : {
          dir,
          missions: [],
          approvals: { count: 0, capped: false },
          missionSeen: false,
          approvalSeen: false,
          stale: false,
          unavailable: false,
        }
  const missionStale = update.missions === undefined
  const approvalStale = update.approvals === undefined
  return {
    dir,
    missions: update.missions ?? current.missions,
    approvals: update.approvals ?? current.approvals,
    missionSeen: current.missionSeen || !missionStale,
    approvalSeen: current.approvalSeen || !approvalStale,
    stale: missionStale || approvalStale,
    unavailable: (missionStale && !current.missionSeen) || (approvalStale && !current.approvalSeen),
  }
}
