import { createMemo, createResource, For, onCleanup, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { approvals, BYTES, missions, project, snapshot, type Snapshot } from "./sidebar-afs-data"
import { run } from "./sidebar-afs-runner"

// Fork-owned AFS sidebar section. Reads project missions and machine-global
// agent approvals straight from the AFS CLI so it works without the halext
// bridge running. Renders only when AFS resolves a registered v2
// project or an explicit v1 compatibility context for the current directory.

const REFRESH_MS = 120_000

type Result = { ok: true; value: unknown } | { ok: false }

function cli() {
  return process.env["AFS_BIN"]?.trim() || process.env["AFS_CLI"]?.trim() || "afs"
}

async function json(args: string[], signal: AbortSignal): Promise<Result> {
  const result = await run([cli(), ...args], { signal, timeout: 10_000, limit: BYTES })
  if (!result || result.code !== 0) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(result.stdout.toString()) as unknown }
  } catch {
    return { ok: false }
  }
}

async function list(dir: string, status: "active" | "blocked", signal: AbortSignal) {
  const args = ["list", "--path", dir, "--status", status, "--limit", "3", "--json"]
  const current = await json(["missions", ...args], signal)
  if (current.ok) return current
  return json(["mission", ...args], signal)
}

async function load(dir: string, signal: AbortSignal) {
  const current = await json(["projects", "current", "--path", dir, "--json"], signal)
  if (!current.ok || !project(current.value)) return
  const [activeMissions, blockedMissions, pending] = await Promise.all([
    list(dir, "active", signal),
    list(dir, "blocked", signal),
    json(["approvals", "list", "--json"], signal),
  ])
  const activeData = activeMissions.ok ? missions(activeMissions.value) : undefined
  const blockedData = blockedMissions.ok ? missions(blockedMissions.value) : undefined
  const missionData = activeData && blockedData ? missions([...activeData, ...blockedData]) : undefined
  const approvalData = pending.ok ? approvals(pending.value) : undefined
  return {
    dir,
    missions: missionData,
    approvals: approvalData,
  }
}

export function SidebarAfs() {
  const { theme } = useTheme()
  const sync = useSync()
  const directory = createMemo(() => sync.data.path.directory || process.cwd())
  let active: AbortController | undefined
  let last: Snapshot | undefined
  const [state, { refetch }] = createResource(directory, async (dir) => {
    active?.abort()
    const next = new AbortController()
    active = next
    const result = await load(dir, next.signal)
    if (active !== next) return
    if (!result) {
      active = undefined
      last = undefined
      return {
        ...snapshot(dir, undefined, { missions: [], approvals: { count: 0, capped: false } }),
        enabled: false,
      }
    }
    active = undefined
    last = snapshot(dir, last, result)
    return {
      ...last,
      enabled: true,
    }
  })
  const timer = setInterval(() => {
    void refetch()
  }, REFRESH_MS)
  onCleanup(() => {
    clearInterval(timer)
    active?.abort()
  })
  const data = createMemo(() => (state.latest?.dir === directory() ? state.latest : undefined))
  const listed = createMemo(() => data()?.missions ?? [])
  const pending = createMemo(() => data()?.approvals ?? { count: 0, capped: false })

  return (
    <Show when={data()?.enabled && (listed().length > 0 || pending().count > 0 || data()?.stale)}>
      <box>
        <text fg={theme.text}>
          <b>AFS</b>
        </text>
        <Show when={data()?.stale}>
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} fg={theme.warning}>
              •
            </text>
            <text fg={theme.warning} wrapMode="word">
              {data()?.unavailable ? "attention unavailable" : "attention stale; showing last known"}
            </text>
          </box>
        </Show>
        <For each={listed()}>
          {(mission) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={mission.status === "blocked" ? theme.warning : theme.success}>
                •
              </text>
              <text fg={theme.text} wrapMode="word">
                {mission.title} <span style={{ fg: theme.textMuted }}>{mission.status}</span>
              </text>
            </box>
          )}
        </For>
        <Show when={pending().count > 0}>
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} fg={theme.warning}>
              •
            </text>
            <text fg={theme.text} wrapMode="word">
              {pending().count}
              {pending().capped ? "+" : ""} global agent approval{pending().count === 1 ? "" : "s"} pending{" "}
              <span style={{ fg: theme.textMuted }}>review via afs approvals</span>
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}
