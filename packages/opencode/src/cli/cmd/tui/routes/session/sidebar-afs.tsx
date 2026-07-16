import { createMemo, createResource, For, onCleanup, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { approvals, BYTES, context, missions, snapshot, type Snapshot } from "./sidebar-afs-data"
import { run } from "./sidebar-afs-runner"

// Fork-owned AFS sidebar section. Reads project-management signals (open
// missions, pending approvals) straight from the AFS CLI so it works without
// the halext bridge running. Renders nothing unless the workspace has a
// .context directory exists at or above the workspace and the CLI returns
// data — plain upstream behavior everywhere else.

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

async function load(dir: string, signal: AbortSignal) {
  const [activeMissions, blockedMissions, pending] = await Promise.all([
    json(["mission", "list", "--path", dir, "--status", "active", "--limit", "3", "--json"], signal),
    json(["mission", "list", "--path", dir, "--status", "blocked", "--limit", "3", "--json"], signal),
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
    if (!context(dir)) {
      active = undefined
      last = undefined
      return {
        ...snapshot(dir, undefined, { missions: [], approvals: { count: 0, capped: false } }),
        enabled: false,
      }
    }
    const result = await load(dir, next.signal)
    if (active !== next) return { ...snapshot(dir, undefined, result), enabled: true }
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
              {pending().capped ? "+" : ""} approval{pending().count === 1 ? "" : "s"} pending{" "}
              <span style={{ fg: theme.textMuted }}>resolve via afs approvals</span>
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}
