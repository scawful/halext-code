import type { AfsMission } from "@halext/bridge"

export type Attention = "ready" | "stale" | "unavailable"

export type AttentionRefresh = {
  generation: number
  path: string
}

export function beginRefresh(current: AttentionRefresh, path: string) {
  const ticket = { generation: current.generation + 1, path }
  return {
    ticket,
    reset: current.path !== path,
  }
}

export function ownsRefresh(current: AttentionRefresh, ticket: AttentionRefresh, visiblePath: string) {
  return current.generation === ticket.generation && current.path === ticket.path && ticket.path === visiblePath
}

export function prioritize(missions: AfsMission[], limit = 5) {
  return missions
    .toSorted((left, right) => Number(right.status === "blocked") - Number(left.status === "blocked"))
    .slice(0, limit)
}

export function availability(failed: boolean[], seen: boolean[]): Attention {
  if (!failed.some(Boolean)) return "ready"
  return failed.some((value, index) => value && !seen[index]) ? "unavailable" : "stale"
}

export function refreshError(owned: string, visible: string, next: string) {
  if (next) {
    return {
      owned: next,
      visible: !visible || visible === owned ? next : visible,
    }
  }
  return {
    owned: "",
    visible: owned && visible === owned ? "" : visible,
  }
}
